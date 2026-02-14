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

// Peer configurations
const webConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
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
    addPeerSlot(); // Start with one empty slot
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

    pttButton.addEventListener('mousedown', startTransmission);
    pttButton.addEventListener('mouseup', stopTransmission);
    pttButton.addEventListener('mouseleave', stopTransmission);
    pttButton.addEventListener('touchstart', (e) => { e.preventDefault(); startTransmission(); });
    pttButton.addEventListener('touchend', stopTransmission);
}

// Peer Management
function addPeerSlot() {
    const peerId = 'peer-' + Date.now();
    const clone = peerTemplate.content.cloneNode(true);
    const card = clone.querySelector('.peer-card');
    card.dataset.peerId = peerId;

    const btnOffer = card.querySelector('.btn-offer');
    const btnAction = card.querySelector('.btn-action');
    const btnRemove = card.querySelector('.btn-remove');
    const outBox = card.querySelector('.out-box');
    const inBox = card.querySelector('.in-box');
    const statusText = card.querySelector('.peer-status');

    btnOffer.onclick = () => createOffer(peerId, outBox, statusText);
    btnAction.onclick = () => handlePeerAction(peerId, inBox, outBox, statusText);
    btnRemove.onclick = () => {
        if (peers[peerId]) {
            peers[peerId].close();
            delete peers[peerId];
        }
        card.remove();
        updateGlobalStatus();
    };

    peerList.appendChild(clone);
}

async function createOffer(peerId, outBox, statusText) {
    const pc = new RTCPeerConnection(currentPCConfig);
    peers[peerId] = pc;
    setupPeerListeners(peerId, statusText);

    localStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStream);
        sender.track.enabled = false;
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    pc.onicecandidate = (event) => {
        if (!event.candidate) {
            outBox.value = btoa(JSON.stringify(pc.localDescription));
            statusText.innerText = 'Offer Ready';
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

            pc.onicecandidate = (event) => {
                if (!event.candidate) {
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

function updateGlobalStatus() {
    const connectedCount = Object.values(peers).filter(pc =>
        pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'
    ).length;

    if (connectedCount > 0) {
        connectionStatus.innerText = `Network: ${connectedCount} Peer(s) Connected`;
        connectionStatus.style.color = 'var(--display-text)';
        try { staticNode.start(); } catch (e) { }
    } else {
        connectionStatus.innerText = 'Network: Offline';
        connectionStatus.style.color = '#888';
    }

    // Update Signal Meter
    meterBar.style.width = Math.min(connectedCount * 25, 100) + '%';
}

init();
