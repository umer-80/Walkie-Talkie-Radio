/**
 * P2P Global Radio - Core Engine (Phase 2)
 */

const pcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let pc;
let localStream;
let audioContext;
let staticNode;
let gainNode;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const createOfferBtn = document.getElementById('create-offer');
const offerOut = document.getElementById('offer-out');
const copyOfferBtn = document.getElementById('copy-offer');

const offerIn = document.getElementById('offer-in');
const createAnswerBtn = document.getElementById('create-answer');
const answerOut = document.getElementById('answer-out');
const copyAnswerBtn = document.getElementById('copy-answer');

const answerIn = document.getElementById('answer-in');
const acceptAnswerBtn = document.getElementById('accept-answer');

const pttButton = document.getElementById('ptt-button');
const txLed = document.getElementById('tx-led');
const rxLed = document.getElementById('rx-led');
const meterBar = document.getElementById('meter-bar');

// Initialization
async function init() {
    setupEventListeners();
    setupAudioContext();
}

function setupAudioContext() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Create static noise node (white noise)
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
    gainNode.gain.value = 0.02; // Very subtle static

    staticNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
    // Note: staticNode doesn't start until interaction or connection
}

function playRogerBeep() {
    const osc = audioContext.createOscillator();
    const g = audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.1);

    g.gain.setValueAtTime(0.1, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

    osc.connect(g);
    g.connect(audioContext.destination);

    osc.start();
    osc.stop(audioContext.currentTime + 0.15);
}

function setupEventListeners() {
    createOfferBtn.addEventListener('click', createOffer);
    createAnswerBtn.addEventListener('click', createAnswer);
    acceptAnswerBtn.addEventListener('click', acceptAnswer);

    copyOfferBtn.addEventListener('click', () => copyToClipboard(offerOut));
    copyAnswerBtn.addEventListener('click', () => copyToClipboard(answerOut));

    // PTT Events
    pttButton.addEventListener('mousedown', startTransmission);
    pttButton.addEventListener('mouseup', stopTransmission);
    pttButton.addEventListener('mouseleave', stopTransmission);

    // Touch Support
    pttButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startTransmission();
    });
    pttButton.addEventListener('touchend', stopTransmission);
}

// Signaling Functions
async function createPeerConnection() {
    pc = new RTCPeerConnection(pcConfig);

    pc.oniceconnectionstatechange = () => {
        connectionStatus.innerText = `Status: ${pc.iceConnectionState}`;
        if (pc.iceConnectionState === 'connected') {
            connectionStatus.style.color = 'var(--display-text)';
            startStatic();
            startStatsMonitoring();
        } else {
            connectionStatus.style.color = '#888';
            stopStatic();
        }
    };

    pc.ontrack = (event) => {
        console.log('Received remote track');
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();

        // Indication of incoming audio
        event.track.onunmute = () => rxLed.classList.add('active-rx');
        event.track.onmute = () => rxLed.classList.remove('active-rx');
    };

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false, // Disabling AGC can improve clarity in PTT scenarios
                channelCount: 1
            }
        });
    } catch (err) {
        console.error('Error accessing media devices:', err);
    }

    return pc;
}

async function createOffer() {
    await createPeerConnection();
    localStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStream);
        sender.track.enabled = false;
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    pc.onicecandidate = (event) => {
        if (!event.candidate) {
            offerOut.value = btoa(JSON.stringify(pc.localDescription));
        }
    };
}

async function createAnswer() {
    await createPeerConnection();
    const offerSdp = JSON.parse(atob(offerIn.value));
    await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));

    localStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, localStream);
        sender.track.enabled = false;
    });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    pc.onicecandidate = (event) => {
        if (!event.candidate) {
            answerOut.value = btoa(JSON.stringify(pc.localDescription));
        }
    };
}

async function acceptAnswer() {
    const answerSdp = JSON.parse(atob(answerIn.value));
    await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
}

// PTT Logic
function startTransmission() {
    if (!pc || pc.iceConnectionState !== 'connected') return;
    if (audioContext.state === 'suspended') audioContext.resume();

    txLed.classList.add('active-tx');

    const senders = pc.getSenders();
    senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = true;
        }
    });
}

function stopTransmission() {
    if (!pc || !txLed.classList.contains('active-tx')) return;

    txLed.classList.remove('active-tx');
    playRogerBeep();

    const senders = pc.getSenders();
    senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = false;
        }
    });
}

// Stats & Feedback
function startStatic() {
    try {
        staticNode.start();
    } catch (e) {
        // Source already started
    }
}

function stopStatic() {
    gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.5);
}

function startStatsMonitoring() {
    setInterval(async () => {
        if (!pc || pc.iceConnectionState !== 'connected') return;

        const stats = await pc.getStats();
        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                // Mocking signal strength based on RTT (lower RTT = better signal)
                const rtt = report.currentRoundTripTime || 0;
                let strength = 100 - (rtt * 500); // Rough math
                strength = Math.max(10, Math.min(100, strength));
                meterBar.style.width = strength + '%';
            }
        });
    }, 1000);
}

// Helpers
function copyToClipboard(elem) {
    elem.select();
    document.execCommand('copy');
}

init();
