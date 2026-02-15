/**
 * P2P Global Radio - Mesh Network Engine (Phase 4)
 */

const pcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let peers = {}; // Dictionary of RTCPeerConnection objects
let localStream;
let audioContext;
let staticNode;
let gainNode;

const localModeToggle = document.getElementById('local-mode-toggle');
const reconnectingOverlay = document.getElementById('reconnecting-overlay');

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
    iceServers: [] // In local mode, we rely on local network candidates only
};

let currentPCConfig = webConfig;
const pttButton = document.getElementById('ptt-button');
const txLed = document.getElementById('tx-led');
const rxLed = document.getElementById('rx-led');
const meterBar = document.getElementById('meter-bar');
const peerList = document.getElementById('peer-list');
const addPeerSlotBtn = document.getElementById('add-peer-slot');
const peerTemplate = document.getElementById('peer-slot-template');

// Initialization
async function init() {
    setupEventListeners();
    setupAudioContext();
    await setupLocalStream();

    // Attempt to restore previous sessions
    const restored = await tryReconnectAll();
    if (!restored) {
        addPeerSlot(); // Start with one empty slot if none restored
    }
}

async function setupLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false,
                channelCount: 1
            }
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
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

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
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.1);
    g.gain.setValueAtTime(0.1, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
    osc.connect(g); g.connect(audioContext.destination);
    osc.start(); osc.stop(audioContext.currentTime + 0.15);
}

function setupEventListeners() {
    addPeerSlotBtn.addEventListener('click', addPeerSlot);

    localModeToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            currentPCConfig = localConfig;
            alert("LOCAL MODE ACTIVE: Connect via Wi-Fi Direct or shared Hotspot. Both devices must be on the same local network.");
        } else {
            currentPCConfig = webConfig;
        }
        updateGlobalStatus();
    });

    pttButton.onpointerdown = (e) => { e.preventDefault(); startTransmission(); };
    pttButton.onpointerup = (e) => { e.preventDefault(); stopTransmission(); };
    pttButton.onpointerleave = (e) => { e.preventDefault(); stopTransmission(); };
}

// Peer Management
function addPeerSlot(existingPeerId = null) {
    const peerId = existingPeerId || 'peer-' + Date.now();
    const clone = peerTemplate.content.cloneNode(true);
    const card = clone.querySelector('.peer-card');
    card.dataset.peerId = peerId;

    const btnOffer = card.querySelector('.btn-offer');
    const btnAction = card.querySelector('.btn-action');
    const btnRemove = card.querySelector('.btn-remove');
    const outBox = card.querySelector('.out-box');
    const inBox = card.querySelector('.in-box');
    const statusText = card.querySelector('.peer-status');

    // QR Elements
    const qrDiv = card.querySelector('.qr-code');
    const btnShare = card.querySelector('.btn-share');
    const btnScan = card.querySelector('.btn-scan');
    const btnImport = card.querySelector('.btn-import');

    let qrcode = null;

    btnOffer.onclick = () => {
        createOffer(peerId, outBox, statusText, (sdp) => {
            if (!qrcode) {
                qrcode = new QRCode(qrDiv, { text: sdp, width: 128, height: 128 });
            } else {
                qrcode.clear();
                qrcode.makeCode(sdp);
            }
            btnShare.disabled = false;
        });
    };

    btnShare.onclick = async () => {
        const qrImg = qrDiv.querySelector('img');
        if (!qrImg) return;
        try {
            const blob = await (await fetch(qrImg.src)).blob();
            const file = new File([blob], 'radio-key.png', { type: 'image/png' });
            if (navigator.share) {
                await navigator.share({ files: [file], title: 'P2P Radio Key', text: 'Scan to connect!' });
            } else {
                alert('Sharing not supported. Please screenshot.');
            }
        } catch (e) { console.error(e); }
    };

    btnScan.onclick = () => startQRScanner(inBox);
    btnImport.onclick = () => importQRImage(inBox);
    btnAction.onclick = () => handlePeerAction(peerId, inBox, outBox, statusText);

    btnRemove.onclick = () => {
        if (peers[peerId]) {
            peers[peerId].close();
            delete peers[peerId];
        }
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

    localStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStream);
        sender.track.enabled = false;
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
            const sdp = btoa(JSON.stringify(pc.localDescription));
            outBox.value = sdp;
            statusText.innerText = 'Offer Ready (Global)';
            if (onReady) onReady(sdp);
        }
    };

    pc.onicecandidate = (event) => {
        if (!event.candidate && pc.iceGatheringState !== 'complete') {
            const sdp = btoa(JSON.stringify(pc.localDescription));
            outBox.value = sdp;
            statusText.innerText = 'Offer Ready';
            if (onReady) onReady(sdp);
        }
    };
}

async function handlePeerAction(peerId, inBox, outBox, statusText) {
    const payload = inBox.value.trim();
    if (!payload) return;

    try {
        const sdp = JSON.parse(atob(payload));

        if (sdp.type === 'offer') {
            // We are the joiner
            const pc = new RTCPeerConnection(currentPCConfig);
            peers[peerId] = pc;
            setupPeerListeners(peerId, statusText);

            localStream.getTracks().forEach(track => {
                const sender = pc.addTrack(track, localStream);
                sender.track.enabled = false;
            });

            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === 'complete') {
                    outBox.value = btoa(JSON.stringify(pc.localDescription));
                    statusText.innerText = 'Answer Ready (Global)';
                }
            };

            pc.onicecandidate = (event) => {
                if (!event.candidate && pc.iceGatheringState !== 'complete') {
                    outBox.value = btoa(JSON.stringify(pc.localDescription));
                    statusText.innerText = 'Answer Ready';
                }
            };
        } else if (sdp.type === 'answer') {
            // We are the host completing the handshake
            if (!peers[peerId]) return;
            await peers[peerId].setRemoteDescription(new RTCSessionDescription(sdp));
        }
    } catch (e) {
        alert('Invalid Key Error');
        console.error(e);
    }
}

function setupPeerListeners(peerId, statusText) {
    const pc = peers[peerId];

    pc.oniceconnectionstatechange = () => {
        statusText.innerText = pc.iceConnectionState;

        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            reconnectingOverlay.style.display = 'flex';
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            reconnectingOverlay.style.display = 'none';
            saveSession(peerId);
        }

        updateGlobalStatus();
    };

    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();

        event.track.onunmute = () => rxLed.classList.add('active-rx');
        event.track.onmute = () => {
            // Check if ANY peer is still transmitting to us
            const anyActive = Object.values(peers).some(p =>
                p.getReceivers().some(r => r.track && !r.track.muted)
            );
            if (!anyActive) rxLed.classList.remove('active-rx');
        };
    };
}

// PTT Logic (Broadcast to ALL peers)
function startTransmission() {
    if (Object.keys(peers).length === 0) return;
    if (audioContext.state === 'suspended') audioContext.resume();

    txLed.classList.add('active-tx');

    Object.values(peers).forEach(pc => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            pc.getSenders().forEach(sender => {
                if (sender.track) sender.track.enabled = true;
            });
        }
    });
}

function stopTransmission() {
    if (!txLed.classList.contains('active-tx')) return;

    txLed.classList.remove('active-tx');
    playRogerBeep();

    Object.values(peers).forEach(pc => {
        pc.getSenders().forEach(sender => {
            if (sender.track) sender.track.enabled = false;
        });
    });
}

// Session Persistence
function saveSession(peerId) {
    const pc = peers[peerId];
    if (!pc) return;
    const session = {
        localDescription: pc.localDescription,
        remoteDescription: pc.remoteDescription
    };
    localStorage.setItem('radio_session_' + peerId, JSON.stringify(session));
}

async function tryReconnectAll() {
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('radio_session_')) {
            const peerId = key.replace('radio_session_', '');
            const data = JSON.parse(localStorage.getItem(key));
            await restoreSession(peerId, data);
            count++;
        }
    }
    return count > 0;
}

async function restoreSession(peerId, data) {
    addPeerSlot(peerId);
    const pc = new RTCPeerConnection(currentPCConfig);
    peers[peerId] = pc;
    const statusText = document.querySelector(`[data-peer-id="${peerId}"] .peer-status`);
    setupPeerListeners(peerId, statusText);

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.remoteDescription));
        await pc.setLocalDescription(new RTCSessionDescription(data.localDescription));
        // Note: RE-ICE will happen automatically if both side are online
    } catch (e) {
        console.error("Failed to restore session for " + peerId, e);
        localStorage.removeItem('radio_session_' + peerId);
    }
}

function updateGlobalStatus() {
    const connectedCount = Object.values(peers).filter(pc =>
        pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'
    ).length;

    if (connectedCount > 0) {
        connectionStatus.innerText = `Network: ${connectedCount} Peer(s) Connected`;
        connectionStatus.style.color = 'var(--display-text)';
        try { if (staticNode.state !== 'running') staticNode.start(); } catch (e) { }
        startStatsMonitoring();
    } else {
        connectionStatus.innerText = 'Network: Offline';
        connectionStatus.style.color = '#888';
    }
}

let statsInterval = null;
function startStatsMonitoring() {
    if (statsInterval) return;
    statsInterval = setInterval(async () => {
        const connectedPeers = Object.values(peers).filter(pc =>
            pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'
        );

        if (connectedPeers.length === 0) {
            clearInterval(statsInterval);
            statsInterval = null;
            meterBar.style.width = '0%';
            return;
        }

        let totalRtt = 0;
        let count = 0;

        for (const pc of connectedPeers) {
            const stats = await pc.getStats();
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
                    totalRtt += report.currentRoundTripTime;
                    count++;
                }
            });
        }

        if (count > 0) {
            const avgRtt = totalRtt / count;
            // 0ms = 100%, 500ms+ = 10%
            let strength = 100 - (avgRtt * 200);
            strength = Math.max(10, Math.min(100, strength));
            meterBar.style.width = strength + '%';
        } else {
            meterBar.style.width = (connectedPeers.length * 25) + '%';
        }
    }, 2000);
}

// QR Helper Functions
function startQRScanner(inBox) {
    const readerDiv = document.createElement('div');
    readerDiv.id = 'qr-reader';
    document.body.appendChild(readerDiv);

    const html5QrCode = new Html5Qrcode("qr-reader");
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            inBox.value = decodedText;
            html5QrCode.stop();
            readerDiv.remove();
        },
        (errorMessage) => { /* ignore minor errors */ }
    ).catch(err => {
        alert("Camera access denied or error: " + err);
        readerDiv.remove();
    });
}

function importQRImage(inBox) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const html5QrCode = new Html5Qrcode("qr-reader-hidden");
        html5QrCode.scanFile(file, true)
            .then(decodedText => {
                inBox.value = decodedText;
            })
            .catch(err => {
                alert("Could not find a valid QR code in this image.");
                console.error(err);
            });
    };
    input.click();
}

init();
