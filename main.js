/**
 * P2P Global Radio - Premium Sync Engine (Phase 5 Refinement)
 */

let peers = {}; // Dictionary of RTCPeerConnection objects
let localStream;
let audioContext;
let staticNode;
let gainNode;

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
    const bufferSize = 2 * audioContext.sampleRate;
    const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

    staticNode = audioContext.createBufferSource();
    staticNode.buffer = noiseBuffer;
    staticNode.loop = true;
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0.01;
    staticNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
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

    localModeToggle.addEventListener('change', (e) => {
        currentPCConfig = e.target.checked ? localConfig : webConfig;
        updateGlobalStatus();
    });

    pttButton.onpointerdown = (e) => { e.preventDefault(); startTransmission(); };
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
        } catch (e) {
            console.error("QR Fail:", e);
            modalQrBox.innerHTML = '<div style="color:#ff4444; font-size:0.6rem;">QR Generation Failed. Try again.</div>';
        }
        modalShareBtn.disabled = false;
    });

    // Start Camera attempt after short delay
    setTimeout(startQRScannerModal, 1200);
}

function setSyncStep(step) {
    syncSteps.forEach((s, i) => s.classList.toggle('active', i === step - 1));
    syncDots.forEach((d, i) => d.classList.toggle('active', i === step - 1));
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
            blob = await (await fetch(qrImg.src)).blob();
        }

        const file = new File([blob], 'radio-invite.png', { type: 'image/png' });

        if (navigator.share) {
            await navigator.share({ files: [file], title: 'Radio Invite', text: 'Scan this QR to connect to my radio!' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'radio-invite.png';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            alert("Image saved to your downloads/gallery.");
        }
    } catch (e) {
        console.error(e);
        alert("Could not share image. Please take a screenshot of the QR code.");
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
        const compressed = thinSDP(JSON.stringify(pc.localDescription));
        outBox.value = compressed;
        if (onReady) onReady(compressed);
        sdpSent = true;
    };

    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') sendSDP(); };
    pc.onicecandidate = (e) => {
        if (!e.candidate || e.candidate.candidate.includes('srflx')) sendSDP();
    };
    setTimeout(sendSDP, 6000); // Wait up to 6s for global candidates
}

function thinSDP(sdpJson) {
    const sdp = JSON.parse(sdpJson);
    let raw = sdp.sdp;

    // EXTREME THINNING: Strip almost everything except essential fingerprint and ONE candidate
    const lines = raw.split('\r\n');
    let essentialLines = [];
    let candidateCount = 0;

    for (let line of lines) {
        // Keep essential identity lines
        if (line.startsWith('v=') || line.startsWith('o=') || line.startsWith('s=') ||
            line.startsWith('t=') || line.startsWith('m=') || line.startsWith('c=') ||
            line.startsWith('a=mid:') || line.startsWith('a=fingerprint:') ||
            line.startsWith('a=setup:') || line.startsWith('a=rtcp-mux') ||
            line.startsWith('a=msid-semantic:')) {
            essentialLines.push(line);
        }
        // Keep ONLY the first srflx (global) or host candidate
        else if (line.startsWith('a=candidate:') && candidateCount < 1) {
            if (line.includes('srflx') || line.includes('host')) {
                essentialLines.push(line);
                candidateCount++;
            }
        }
        // Keep ICE ufrag/pwd
        else if (line.startsWith('a=ice-ufrag:') || line.startsWith('a=ice-pwd:')) {
            essentialLines.push(line);
        }
    }

    sdp.sdp = essentialLines.join('\r\n');
    return btoa(JSON.stringify(sdp));
}

async function handlePeerAction(peerId, payload, outBox, statusText, onAnswerReady) {
    try {
        const sdp = JSON.parse(atob(payload));
        if (sdp.type === 'offer') {
            const pc = new RTCPeerConnection(currentPCConfig);
            peers[peerId] = pc;
            setupPeerListeners(peerId, statusText);
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
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
            pc.onicecandidate = (e) => { if (!e.candidate || e.candidate.candidate.includes('srflx')) sendAnswer(); };
            setTimeout(sendAnswer, 6000);
        } else {
            if (peers[peerId]) await peers[peerId].setRemoteDescription(new RTCSessionDescription(sdp));
        }
    } catch (e) {
        console.error('Handshake Error:', e);
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
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
        event.track.onunmute = () => rxLed.classList.add('active-rx');
        event.track.onmute = () => {
            const active = Object.values(peers).some(p => p.getReceivers().some(r => r.track && !r.track.muted));
            if (!active) rxLed.classList.remove('active-rx');
        };
    };
}

// PTT Logic
function startTransmission() {
    if (Object.keys(peers).length === 0) return;
    if (audioContext.state === 'suspended') audioContext.resume();
    txLed.classList.add('active-tx');
    Object.values(peers).forEach(pc => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            pc.getSenders().forEach(s => { if (s.track) s.track.enabled = true; });
        }
    });
}

function stopTransmission() {
    if (!txLed.classList.contains('active-tx')) return;
    txLed.classList.remove('active-tx');
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

    // Cleanup existing instance
    if (html5QrCodeModal) {
        try { await html5QrCodeModal.stop(); } catch (e) { }
        html5QrCodeModal = null;
    }

    const scannerContainer = document.getElementById('scanner-view-modal');
    if (!scannerContainer) return;

    // Ensure button is there
    const existingBtn = document.getElementById('start-cam-btn');
    if (!existingBtn) {
        scannerContainer.innerHTML = '<button id="start-cam-btn" class="btn-primary" style="font-size: 0.8rem; padding: 12px 24px; position:relative; z-index:100;">ACTIVATE CAMERA</button>';
    }

    const camBtn = document.getElementById('start-cam-btn');
    camBtn.style.display = 'block';

    html5QrCodeModal = new Html5Qrcode("scanner-view-modal");

    const startCam = async (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        try {
            camBtn.innerText = "STARTING...";
            await html5QrCodeModal.start(
                { facingMode: "environment" },
                { fps: 20, qrbox: (width, height) => ({ width: Math.min(width, height) * 0.8, height: Math.min(width, height) * 0.8 }) },
                (text) => {
                    handleScannedData(text);
                    stopQRScannerModal();
                }
            );
            camBtn.style.display = 'none';
        } catch (err) {
            console.error(err);
            camBtn.innerText = "ACTIVATE CAMERA";
            // alert("Camera error: " + err);
        }
    };

    camBtn.onclick = startCam;

    // Attempt auto-start with a small delay
    setTimeout(() => { if (getSyncStep() === 2) startCam(); }, 800);
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
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const scanner = new Html5Qrcode("qr-reader-hidden");
        scanner.scanFile(file, true).then(text => handleScannedData(text)).catch(e => alert("No QR found"));
    };
    input.click();
}

init();
