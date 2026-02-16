/**
 * P2P Global Radio - Premium Sync Engine (Phase 5 Refinement)
 */

let peers = {}; // Dictionary of RTCPeerConnection objects
let localStream;
let audioContext;
let staticNode;
let gainNode;
let masterGain;

// DOM Elements
const localModeToggle = document.getElementById('local-mode-toggle');
const reconnectingOverlay = document.getElementById('reconnecting-overlay');
const pttButton = document.getElementById('ptt-button');
const txLed = document.getElementById('tx-led');
const rxLed = document.getElementById('rx-led');
const meterBar = document.getElementById('meter-bar');
const peerList = document.getElementById('peer-list');
const peerTemplate = document.getElementById('peer-slot-template');
const connectionStatus = document.getElementById('connection-status');

// Premium Modal Elements
const syncModal = document.getElementById('sync-modal');
const openSyncBtn = document.getElementById('open-sync-btn');
const closeSyncBtn = document.getElementById('close-modal-btn');
const modalQrBox = document.getElementById('modal-qr');
const modalShareBtn = document.getElementById('modal-share-btn');
const modalImportBtn = document.getElementById('modal-import-btn');
const finishSyncBtn = document.getElementById('finish-sync-btn');
const syncSteps = document.querySelectorAll('.sync-step');
const syncDots = document.querySelectorAll('.dot');

// Peer configurations
const webConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

const localConfig = {
    iceServers: []
};

let currentPCConfig = webConfig;
let activeSyncPeerId = null;

// Initialization
async function init() {
    setupEventListeners();
    setupAudioContext();
    await setupLocalStream();
    await tryReconnectAll();
}

async function setupLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }
        });
    } catch (err) {
        console.error('Error accessing media devices:', err);
    }
}

function setupAudioContext() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);

    const bufferSize = 2 * audioContext.sampleRate;
    const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

    staticNode = audioContext.createBufferSource();
    staticNode.buffer = noiseBuffer;
    staticNode.loop = true;
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0.008; // Base static volume
    staticNode.connect(gainNode);
    gainNode.connect(masterGain);
    staticNode.start();
}

function setStaticDucking(duck) {
    if (!gainNode || !audioContext) return;
    const target = duck ? 0.001 : 0.008;
    gainNode.gain.setTargetAtTime(target, audioContext.currentTime, 0.1);
}

function playRogerBeep() {
    const osc = audioContext.createOscillator();
    const g = audioContext.createGain();
    osc.frequency.setValueAtTime(1000, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.1);
    g.gain.setValueAtTime(0.1, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
    osc.connect(g); g.connect(audioContext.destination);
    osc.start(); osc.stop(audioContext.currentTime + 0.15);
}

function setupEventListeners() {
    openSyncBtn.onclick = () => startGuidedSync();
    closeSyncBtn.onclick = closeSyncModal;
    finishSyncBtn.onclick = closeSyncModal;
    modalShareBtn.onclick = shareModalQR;
    modalImportBtn.onclick = () => importQRImage();

    // New Step Navigation Buttons
    document.getElementById('go-to-step2-btn').onclick = () => setSyncStep(2);
    document.getElementById('go-to-step1-btn').onclick = () => setSyncStep(1);

    // Diagnostic Handlers
    const pasteArea = document.getElementById('paste-area');
    const doPasteBtn = document.getElementById('do-paste-btn');
    document.getElementById('modal-paste-btn').onclick = () => {
        pasteArea.style.display = pasteArea.style.display === 'none' ? 'block' : 'none';
    };
    doPasteBtn.onclick = () => {
        const text = document.getElementById('sync-paste-input').value.trim();
        if (text) {
            handleScannedData(text);
            document.getElementById('sync-paste-input').value = "";
            pasteArea.style.display = 'none';
        }
    };
    const copyArea = document.getElementById('copyable-sync-string');
    copyArea.onclick = () => {
        const text = copyArea.getAttribute('data-sync');
        if (text) {
            copyArea.innerText = text;
            copyArea.style.color = "#00ff00";
            navigator.clipboard.writeText(text).catch(() => { });
        }
    };

    localModeToggle.addEventListener('change', (e) => {
        currentPCConfig = e.target.checked ? localConfig : webConfig;
        updateGlobalStatus();
    });

    pttButton.onpointerdown = async (e) => {
        e.preventDefault();
        if (audioContext && audioContext.state === 'suspended') await audioContext.resume();
        startTransmission();
    };
    pttButton.onpointerup = (e) => { e.preventDefault(); stopTransmission(); };
    pttButton.onpointerleave = (e) => { e.preventDefault(); stopTransmission(); };
}

// PREMIUM SYNC FLOW
async function startGuidedSync() {
    activeSyncPeerId = addPeerSlot();
    setSyncStep(1);
    syncModal.style.display = 'flex';

    const card = document.querySelector(`[data-peer-id="${activeSyncPeerId}"]`);
    const outBox = card.querySelector('.out-box');
    const statusText = card.querySelector('.peer-status');

    modalQrBox.innerHTML = '<div class="qr-loading">GATHERING GLOBAL SIGNAL...</div>';
    modalShareBtn.disabled = true;

    createOffer(activeSyncPeerId, outBox, statusText, (sdp) => {
        modalQrBox.innerHTML = '';
        try {
            // RENDER CLEAN QR: Using thinned SDP for maximum compatibility
            new QRCode(modalQrBox, {
                text: sdp,
                width: 240,
                height: 240,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.L
            });
            // Update Diagnostic String
            const copyArea = document.getElementById('copyable-sync-string');
            if (copyArea) {
                copyArea.setAttribute('data-sync', sdp);
                copyArea.innerText = "Click to Reveal Sync String";
                copyArea.style.color = "#555";
            }
        } catch (e) {
            console.error("QR Fail:", e);
            modalQrBox.innerHTML = '<div style="color:#ff4444; font-size:0.6rem;">QR Generation Failed. Try again.</div>';
        }
        modalShareBtn.disabled = false;
    });

    // Start Camera after safety delay
    setTimeout(() => {
        if (getSyncStep() === 2) startQRScannerModal();
    }, 1500);
}

function setSyncStep(step) {
    syncSteps.forEach((s, i) => s.classList.toggle('active', i === step - 1));
    syncDots.forEach((d, i) => d.classList.toggle('active', i === step - 1));
    if (step === 2) startQRScannerModal();
}

function getSyncStep() {
    let active = 1;
    syncSteps.forEach((s, i) => { if (s.classList.contains('active')) active = i + 1; });
    return active;
}

function closeSyncModal() {
    syncModal.style.display = 'none';
    stopQRScannerModal();
}

async function shareModalQR() {
    const qrImg = modalQrBox.querySelector('img') || modalQrBox.querySelector('canvas');
    if (!qrImg) return;

    try {
        let blob;
        if (qrImg.tagName === 'CANVAS') {
            blob = await new Promise(resolve => qrImg.toBlob(resolve, 'image/png'));
        } else {
            const response = await fetch(qrImg.src);
            blob = await response.blob();
        }

        const file = new File([blob], 'radio-invite.png', { type: 'image/png' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'Radio Sync Invite',
                text: 'Scan this code to connect to my radio!'
            });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'radio-invite.png';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 1000);

            const toast = document.createElement('div');
            toast.className = 'connection-alert';
            toast.style.display = 'block';
            toast.innerText = "QR DOWNLOADED! If it didn't save, please TAKE A SCREENSHOT.";
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        }
    } catch (e) {
        console.error(e);
        alert("Please take a SCREENSHOT to share this QR code.");
    }
}

// Peer Management
function addPeerSlot(existingPeerId = null) {
    const peerId = existingPeerId || 'peer-' + Date.now();
    if (document.querySelector(`[data-peer-id="${peerId}"]`)) return peerId;

    const clone = peerTemplate.content.cloneNode(true);
    const card = clone.querySelector('.peer-card');
    card.dataset.peerId = peerId;

    card.querySelector('.btn-remove-mini').onclick = () => {
        if (peers[peerId]) peers[peerId].close();
        delete peers[peerId];
        localStorage.removeItem('radio_session_' + peerId);
        card.remove();
        updateGlobalStatus();
    };

    peerList.appendChild(clone);
    return peerId;
}

async function createOffer(peerId, outBox, statusText, onReady) {
    const pc = new RTCPeerConnection(currentPCConfig);
    peers[peerId] = pc;
    setupPeerListeners(peerId, statusText);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    let sdpSent = false;
    const sendSDP = () => {
        if (sdpSent) return;
        const full = btoa(JSON.stringify(pc.localDescription));
        outBox.value = full;
        if (onReady) onReady(full);
        sdpSent = true;
    };

    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') sendSDP(); };
    pc.onicecandidate = (e) => { if (!e.candidate) sendSDP(); };
    setTimeout(sendSDP, 8000);
}

// NO THINNING: Send the full, exact SDP the browser generated
function thinSDP(sdpJson) {
    return btoa(sdpJson);
}

async function handlePeerAction(peerId, payload, outBox, statusText, onAnswerReady) {
    try {
        if (!payload || payload.length < 10) return;
        const sdp = JSON.parse(atob(payload.trim()));

        if (sdp.type === 'offer') {
            const pc = new RTCPeerConnection(currentPCConfig);
            peers[peerId] = pc;
            setupPeerListeners(peerId, statusText);

            if (localStream) {
                localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
            }

            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            let sdpSent = false;
            const sendAnswer = () => {
                if (sdpSent) return;
                const compressed = thinSDP(JSON.stringify(pc.localDescription));
                outBox.value = compressed;
                if (onAnswerReady) onAnswerReady(compressed);
                sdpSent = true;
            };
            pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') sendAnswer(); };
            pc.onicecandidate = (e) => { if (!e.candidate) sendAnswer(); };
            setTimeout(sendAnswer, 6000);
        } else {
            if (peers[peerId]) await peers[peerId].setRemoteDescription(new RTCSessionDescription(sdp));
        }
    } catch (e) {
        console.error('Handshake Error:', e);
        alert(`SYNC FAILED: ${e.message}\nMake sure both devices have refreshed.`);
    }
}

function setupPeerListeners(peerId, statusText) {
    const pc = peers[peerId];
    pc.oniceconnectionstatechange = () => {
        statusText.innerText = pc.iceConnectionState.toUpperCase();
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            reconnectingOverlay.style.display = 'flex';
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            reconnectingOverlay.style.display = 'none';
            saveSession(peerId);
            if (activeSyncPeerId === peerId && getSyncStep() < 3) setSyncStep(3);
        }
        updateGlobalStatus();
    };

    pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        const source = audioContext.createMediaStreamSource(remoteStream);
        const pGain = audioContext.createGain();
        source.connect(pGain);
        pGain.connect(masterGain);

        event.track.onunmute = () => {
            rxLed.classList.add('active-rx');
            setStaticDucking(true);
        };
        event.track.onmute = () => {
            const active = Object.values(peers).some(p => p.getReceivers().some(r => r.track && !r.track.muted));
            if (!active) {
                rxLed.classList.remove('active-rx');
                setStaticDucking(false);
            }
        };
    };
}

// PTT Logic
function startTransmission() {
    if (Object.keys(peers).length === 0) return;
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    txLed.classList.add('active-tx');
    setStaticDucking(true);
    Object.values(peers).forEach(pc => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            pc.getSenders().forEach(s => { if (s.track) s.track.enabled = true; });
        }
    });
}

function stopTransmission() {
    if (!txLed.classList.contains('active-tx')) return;
    txLed.classList.remove('active-tx');
    setStaticDucking(false);
    playRogerBeep();
    Object.values(peers).forEach(pc => pc.getSenders().forEach(s => { if (s.track) s.track.enabled = false; }));
}

// Session
function saveSession(peerId) {
    const pc = peers[peerId];
    if (!pc || !pc.remoteDescription) return;
    localStorage.setItem('radio_session_' + peerId, JSON.stringify({
        localDescription: pc.localDescription, remoteDescription: pc.remoteDescription
    }));
}

async function tryReconnectAll() {
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('radio_session_')) {
            const peerId = key.replace('radio_session_', '');
            const data = JSON.parse(localStorage.getItem(key));
            addPeerSlot(peerId);
            const statusText = document.querySelector(`[data-peer-id="${peerId}"] .peer-status`);
            const pc = new RTCPeerConnection(currentPCConfig);
            peers[peerId] = pc;
            setupPeerListeners(peerId, statusText);
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.remoteDescription));
                await pc.setLocalDescription(new RTCSessionDescription(data.localDescription));
            } catch (e) { localStorage.removeItem(key); }
        }
    }
}

function updateGlobalStatus() {
    const connected = Object.values(peers).filter(pc => pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed').length;
    connectionStatus.innerText = connected > 0 ? `NETWORK: ${connected} PEER(S) CONNECTED` : 'NETWORK: OFFLINE';
    connectionStatus.style.color = connected > 0 ? 'var(--display-text)' : '#888';
    if (connected > 0) {
        try { if (staticNode.state !== 'running') staticNode.start(); } catch (e) { }
        startStatsMonitoring();
    }
}

let statsInterval = null;
function startStatsMonitoring() {
    if (statsInterval) return;
    statsInterval = setInterval(async () => {
        const connected = Object.values(peers).filter(pc => pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
        if (connected.length === 0) {
            clearInterval(statsInterval);
            statsInterval = null;
            meterBar.style.width = '0%';
            return;
        }
        let totalRtt = 0, count = 0;
        for (const pc of connected) {
            (await pc.getStats()).forEach(r => {
                if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime) {
                    totalRtt += r.currentRoundTripTime; count++;
                }
            });
        }
        if (count > 0) {
            let strength = 100 - ((totalRtt / count) * 200);
            meterBar.style.width = Math.max(10, Math.min(100, strength)) + '%';
        } else {
            meterBar.style.width = (connected.length * 25) + '%';
        }
    }, 2000);
}

// QR MODAL HELPERS
let html5QrCodeModal = null;
async function startQRScannerModal() {
    if (getSyncStep() !== 2) return;

    // HARD KILL OLD INSTANCES
    if (html5QrCodeModal) {
        try { await html5QrCodeModal.stop(); } catch (e) { }
        try { html5QrCodeModal.clear(); } catch (e) { }
        html5QrCodeModal = null;
    }

    const scannerContainer = document.getElementById('scanner-view-modal');
    if (!scannerContainer) return;

    scannerContainer.innerHTML = '<button id="start-cam-btn" class="btn-primary" style="font-size:0.8rem; padding:12px 24px; position:relative; z-index:1000;">ACTIVATE CAMERA</button>';
    const camBtn = document.getElementById('start-cam-btn');

    camBtn.onclick = async () => {
        try {
            camBtn.innerText = "STARTING...";
            camBtn.disabled = true;

            // Step 1: Enumerate available cameras
            const cameras = await Html5Qrcode.getCameras();
            if (!cameras || cameras.length === 0) {
                throw new Error("No cameras found on this device.");
            }

            // Step 2: Pick best camera (prefer back/environment)
            let cameraId = cameras[0].id;
            for (const cam of cameras) {
                const label = (cam.label || '').toLowerCase();
                if (label.includes('back') || label.includes('environment') || label.includes('rear')) {
                    cameraId = cam.id;
                    break;
                }
            }

            // Step 3: Start with specific camera ID (no facingMode issues)
            html5QrCodeModal = new Html5Qrcode("scanner-view-modal");
            await html5QrCodeModal.start(
                cameraId,
                {
                    fps: 20,
                    qrbox: (w, h) => {
                        const min = Math.min(w, h);
                        return { width: min * 0.7, height: min * 0.7 };
                    },
                    aspectRatio: 1.0,
                    showTorchButtonIfSupported: true
                },
                (text) => {
                    handleScannedData(text);
                    stopQRScannerModal();
                },
                () => { } // ignore failed scans
            );
            camBtn.style.display = 'none';

        } catch (err) {
            console.error("Camera Error:", err);
            camBtn.innerText = "ACTIVATE CAMERA";
            camBtn.disabled = false;
            alert("Camera Error: " + (err.message || err) + "\nTry closing other tabs using the camera, or use IMPORT FROM GALLERY.");
        }
    };
}

function stopQRScannerModal() {
    if (html5QrCodeModal) {
        html5QrCodeModal.stop().then(() => {
            html5QrCodeModal = null;
            document.getElementById('scanner-view-modal').innerHTML = '';
        });
    }
}

function handleScannedData(data) {
    const card = document.querySelector(`[data-peer-id="${activeSyncPeerId}"]`);
    if (!card) return;
    const outBox = card.querySelector('.out-box');
    const statusText = card.querySelector('.peer-status');

    handlePeerAction(activeSyncPeerId, data, outBox, statusText, (answerSdp) => {
        modalQrBox.innerHTML = '';

        // Diagnostic String for Answer
        const copyArea = document.getElementById('copyable-sync-string');
        if (copyArea) {
            copyArea.setAttribute('data-sync', answerSdp);
            copyArea.innerText = "Click to Reveal NEW Sync String";
            copyArea.style.color = "#555";
        }

        new QRCode(modalQrBox, {
            text: answerSdp,
            width: 240,
            height: 240,
            correctLevel: QRCode.CorrectLevel.L
        });
        setSyncStep(1);
        modalShareBtn.disabled = false;
    });
}

function importQRImage() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const scanner = new Html5Qrcode("qr-reader-hidden");

        // Use scanFile for better reliability on images
        scanner.scanFile(file, true)
            .then(text => handleScannedData(text))
            .catch(err => {
                console.error("Scan fail:", err);
                alert("COULD NOT READ QR:\nPlease ensure the photo is clear and the QR is fully visible.");
            });
    };
    input.click();
}

init();
