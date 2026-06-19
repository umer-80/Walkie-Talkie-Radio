/**
 * P2P Radio — Core Application
 * 
 * This file handles EVERYTHING:
 * 1. Connecting to the signaling server (WebSocket)
 * 2. Creating/joining channels
 * 3. WebRTC peer connection (audio only, P2P)
 * 4. Push-to-Talk (PTT) logic
 * 5. Real-time stats display
 * 
 * The flow is:
 *   User creates/joins channel → server pairs two users →
 *   WebRTC negotiation happens automatically →
 *   audio flows directly P2P (server not involved)
 */

// ============================================================
// CONFIGURATION
// ============================================================

// ICE servers: STUN discovers your public IP, TURN relays audio
// if direct P2P fails (symmetric NATs, firewalls, CGNAT)
const ICE_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        // Free TURN relay — works through any firewall
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

// ============================================================
// STATE
// ============================================================

let ws = null;              // WebSocket to signaling server
let pc = null;              // RTCPeerConnection (the P2P link)
let localStream = null;     // Microphone audio stream
let audioContext = null;    // For roger beep
let channelCode = null;     // Current channel code
let isCreator = false;      // Did we create the channel?
let statsInterval = null;   // Stats polling timer

// ============================================================
// DOM ELEMENTS
// ============================================================

const statusBadge = document.getElementById('connection-status');
const channelDisplay = document.getElementById('channel-display');
const statusLine = document.getElementById('status-line');
const meterBar = document.getElementById('meter-bar');
const txLed = document.getElementById('tx-led');
const rxLed = document.getElementById('rx-led');
const pttButton = document.getElementById('ptt-button');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const joinInput = document.getElementById('join-input');
const channelControls = document.getElementById('channel-controls');
const channelActive = document.getElementById('channel-active');
const activeCode = document.getElementById('active-code');
const activeStats = document.getElementById('active-stats');
const disconnectBtn = document.getElementById('disconnect-btn');

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
    // 1. Capture microphone (start MUTED — PTT will enable)
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 24000,  // 24kHz mono as per requirements
                channelCount: 1
            }
        });
        // Start with mic MUTED — PTT will enable it
        localStream.getAudioTracks().forEach(t => { t.enabled = false; });
        console.log('✅ Microphone captured (muted until PTT)');
    } catch (err) {
        console.error('❌ Mic error:', err);
        setStatus('MIC ERROR', 'offline');
        statusLine.textContent = 'Microphone permission denied';
        alert('Please allow microphone access to use P2P Radio.');
        return;
    }

    // 2. Setup AudioContext (for roger beep sound effect)
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn('AudioContext not available');
    }

    // 3. Setup UI event listeners
    setupUI();

    // 4. Connect to signaling server
    connectSignaling();
}

// ============================================================
// UI SETUP
// ============================================================

function setupUI() {
    // CREATE CHANNEL button
    createBtn.onclick = () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            alert('Not connected to signaling server. Please wait...');
            return;
        }
        ws.send(JSON.stringify({ type: 'create-channel' }));
        createBtn.disabled = true;
        createBtn.textContent = '⏳ CREATING...';
    };

    // JOIN CHANNEL button
    joinBtn.onclick = () => {
        const code = joinInput.value.trim().toUpperCase();
        if (!code) {
            joinInput.focus();
            return;
        }
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            alert('Not connected to signaling server. Please wait...');
            return;
        }
        ws.send(JSON.stringify({ type: 'join-channel', code }));
        joinBtn.disabled = true;
        joinBtn.textContent = '⏳';
    };

    // Also allow Enter key to join
    joinInput.onkeydown = (e) => {
        if (e.key === 'Enter') joinBtn.click();
    };

    // DISCONNECT button
    disconnectBtn.onclick = disconnect;

    // PTT button — use pointer events for mobile + desktop
    pttButton.onpointerdown = (e) => {
        e.preventDefault();
        startPTT();
    };
    pttButton.onpointerup = (e) => {
        e.preventDefault();
        stopPTT();
    };
    pttButton.onpointerleave = (e) => {
        e.preventDefault();
        stopPTT();
    };

    // Unlock AudioContext on first user gesture
    const unlockAudio = () => {
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
}

// ============================================================
// SIGNALING SERVER (WebSocket)
// ============================================================

function connectSignaling() {
    const url = window.SIGNALING_URL || 'ws://localhost:3000';
    setStatus('CONNECTING', 'connecting');
    statusLine.textContent = 'Connecting to server...';

    ws = new WebSocket(url);

    ws.onopen = () => {
        console.log('✅ Connected to signaling server');
        setStatus('READY', 'offline');
        statusLine.textContent = 'Create or Join a channel';
        // Re-enable buttons
        createBtn.disabled = false;
        createBtn.textContent = '📻 CREATE CHANNEL';
        joinBtn.disabled = false;
        joinBtn.textContent = 'JOIN';
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleSignalingMessage(msg);
    };

    ws.onclose = () => {
        console.log('❌ Signaling server disconnected');
        setStatus('OFFLINE', 'offline');
        statusLine.textContent = 'Server disconnected';
        // Retry connection after 3 seconds
        setTimeout(connectSignaling, 3000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

function handleSignalingMessage(msg) {
    switch (msg.type) {
        // --- Server created a channel for us ---
        case 'channel-created':
            channelCode = msg.code;
            isCreator = true;
            showActiveChannel(msg.code);
            channelDisplay.textContent = msg.code;
            statusLine.textContent = 'Waiting for partner to join...';
            setStatus('WAITING', 'connecting');
            console.log(`📻 Channel created: ${msg.code}`);
            break;

        // --- We successfully joined a channel ---
        case 'joined-channel':
            channelCode = msg.code;
            isCreator = false;
            showActiveChannel(msg.code);
            channelDisplay.textContent = msg.code;
            statusLine.textContent = 'Partner found! Connecting...';
            setStatus('CONNECTING', 'connecting');
            // Joiner creates the WebRTC offer
            startWebRTC(true);
            break;

        // --- Our partner joined (we're the creator) ---
        case 'partner-joined':
            statusLine.textContent = 'Partner joined! Connecting...';
            setStatus('CONNECTING', 'connecting');
            // Creator waits for the offer from joiner
            startWebRTC(false);
            break;

        // --- WebRTC signaling data (offer/answer/ICE) ---
        case 'signal':
            handleWebRTCSignal(msg.data);
            break;

        // --- Partner disconnected ---
        case 'partner-left':
            statusLine.textContent = 'Partner disconnected';
            setStatus('OFFLINE', 'offline');
            channelDisplay.textContent = '---';
            pttButton.disabled = true;
            cleanupWebRTC();
            break;

        // --- Error from server ---
        case 'error':
            alert(msg.message);
            createBtn.disabled = false;
            createBtn.textContent = '📻 CREATE CHANNEL';
            joinBtn.disabled = false;
            joinBtn.textContent = 'JOIN';
            break;
    }
}

// ============================================================
// WEBRTC (The P2P Connection)
// ============================================================

function startWebRTC(shouldCreateOffer) {
    // Clean up any existing connection
    cleanupWebRTC();

    // Create a new peer connection
    pc = new RTCPeerConnection(ICE_CONFIG);

    // Add our microphone tracks to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
        console.log('🎤 Local audio tracks added to peer connection');
    }

    // --- HANDLE ICE CANDIDATES ---
    // These are network "routes" that WebRTC discovers to reach the other peer
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            // Send each ICE candidate to the other peer via signaling server
            ws.send(JSON.stringify({
                type: 'signal',
                data: { type: 'ice-candidate', candidate: event.candidate }
            }));
        }
    };

    // --- HANDLE CONNECTION STATE ---
    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log(`ICE state: ${state}`);

        switch (state) {
            case 'checking':
                statusLine.textContent = 'Connecting...';
                setStatus('CONNECTING', 'connecting');
                break;

            case 'connected':
            case 'completed':
                statusLine.textContent = 'Connected! Hold PTT to talk';
                setStatus('CONNECTED', 'connected');
                channelDisplay.textContent = channelCode;
                pttButton.disabled = false;
                startStatsMonitor();
                break;

            case 'disconnected':
                statusLine.textContent = 'Connection unstable...';
                setStatus('UNSTABLE', 'connecting');
                break;

            case 'failed':
                statusLine.textContent = 'Connection failed';
                setStatus('FAILED', 'offline');
                pttButton.disabled = true;
                break;

            case 'closed':
                statusLine.textContent = 'Disconnected';
                setStatus('OFFLINE', 'offline');
                pttButton.disabled = true;
                break;
        }
    };

    // --- HANDLE INCOMING AUDIO ---
    // When the remote peer's audio track arrives, play it
    pc.ontrack = (event) => {
        console.log('🔊 Received remote audio track');
        const stream = event.streams[0];

        // Create a hidden audio element to play the remote audio
        let audio = document.getElementById('remote-audio');
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = 'remote-audio';
            audio.autoplay = true;
            audio.playsInline = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = stream;

        // Force play (bypasses autoplay policy since user has interacted)
        const tryPlay = () => {
            audio.play().catch(err => {
                console.warn('Autoplay blocked, retrying on gesture...', err);
                const unlock = () => {
                    audio.play().catch(() => { });
                    document.removeEventListener('click', unlock);
                    document.removeEventListener('touchstart', unlock);
                };
                document.addEventListener('click', unlock);
                document.addEventListener('touchstart', unlock);
            });
        };
        tryPlay();

        // Light up RX LED when remote track unmutes (partner starts talking)
        event.track.onunmute = () => {
            rxLed.classList.add('active-rx');
            tryPlay();
        };
        event.track.onmute = () => {
            rxLed.classList.remove('active-rx');
        };
    };

    // --- CREATE OFFER (if we're the joiner) ---
    if (shouldCreateOffer) {
        createOffer();
    }
}

async function createOffer() {
    try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        // Send offer to the other peer via signaling server
        ws.send(JSON.stringify({
            type: 'signal',
            data: { type: 'offer', sdp: offer }
        }));
        console.log('📤 SDP Offer sent');
    } catch (err) {
        console.error('Failed to create offer:', err);
    }
}

async function handleWebRTCSignal(data) {
    if (!pc) return;

    try {
        if (data.type === 'offer') {
            // Received an offer — set it and send back an answer
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
                type: 'signal',
                data: { type: 'answer', sdp: answer }
            }));
            console.log('📤 SDP Answer sent');

        } else if (data.type === 'answer') {
            // Received an answer — set it (connection will complete)
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            console.log('📥 SDP Answer received');

        } else if (data.type === 'ice-candidate') {
            // Received an ICE candidate — add it to our connection
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (err) {
        console.error('WebRTC signal error:', err);
    }
}

// ============================================================
// PTT (Push-to-Talk)
// ============================================================

function startPTT() {
    if (!pc || pttButton.disabled) return;

    // Resume AudioContext if suspended (mobile browsers)
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();

    // Enable mic track → audio starts flowing to the peer
    if (localStream) {
        localStream.getAudioTracks().forEach(t => { t.enabled = true; });
    }
    // Also enable on the sender side (belt and suspenders)
    if (pc) {
        pc.getSenders().forEach(s => {
            if (s.track && s.track.kind === 'audio') s.track.enabled = true;
        });
    }

    txLed.classList.add('active-tx');
    pttButton.classList.add('pressed');
    console.log('🎤 PTT DOWN — Transmitting');
}

function stopPTT() {
    if (!txLed.classList.contains('active-tx')) return;

    // Disable mic track → silence
    if (localStream) {
        localStream.getAudioTracks().forEach(t => { t.enabled = false; });
    }
    if (pc) {
        pc.getSenders().forEach(s => {
            if (s.track && s.track.kind === 'audio') s.track.enabled = false;
        });
    }

    txLed.classList.remove('active-tx');
    pttButton.classList.remove('pressed');
    console.log('🔇 PTT UP — Silent');

    // Play roger beep
    playRogerBeep();
}

function playRogerBeep() {
    if (!audioContext) return;
    try {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.frequency.setValueAtTime(1000, audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.1);
        gain.gain.setValueAtTime(0.08, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start();
        osc.stop(audioContext.currentTime + 0.15);
    } catch (e) { /* ignore */ }
}

// ============================================================
// STATS MONITOR (Signal Strength + TX/RX counters)
// ============================================================

function startStatsMonitor() {
    if (statsInterval) clearInterval(statsInterval);

    statsInterval = setInterval(async () => {
        if (!pc || pc.iceConnectionState === 'closed') {
            clearInterval(statsInterval);
            statsInterval = null;
            meterBar.style.width = '0%';
            return;
        }

        try {
            const stats = await pc.getStats();
            let tx = 0, rx = 0, rtt = 0;

            stats.forEach(report => {
                if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                    tx = report.bytesSent || 0;
                }
                if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                    rx = report.bytesReceived || 0;
                }
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    rtt = report.currentRoundTripTime || 0;
                }
            });

            // Update stats display
            const rttMs = (rtt * 1000).toFixed(0);
            activeStats.textContent = `TX: ${tx} | RX: ${rx} | RTT: ${rttMs}ms`;

            // Update signal meter based on RTT
            if (rtt > 0) {
                const strength = Math.max(10, Math.min(100, 100 - (rtt * 200)));
                meterBar.style.width = strength + '%';
            } else {
                meterBar.style.width = '50%'; // Default when no RTT data
            }
        } catch (e) { /* ignore stats errors */ }
    }, 1000);
}

// ============================================================
// DISCONNECT & CLEANUP
// ============================================================

function disconnect() {
    cleanupWebRTC();

    // Tell server we're leaving
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }

    // Reset UI
    channelCode = null;
    channelDisplay.textContent = '---';
    statusLine.textContent = 'Create or Join a channel';
    setStatus('OFFLINE', 'offline');
    pttButton.disabled = true;
    meterBar.style.width = '0%';
    activeStats.textContent = 'TX: 0 | RX: 0 | RTT: ---';

    // Show create/join controls again
    channelControls.style.display = 'flex';
    channelActive.style.display = 'none';

    // Reconnect to signaling server (for new channel)
    setTimeout(connectSignaling, 500);
}

function cleanupWebRTC() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
    if (pc) {
        pc.close();
        pc = null;
    }
    // Remove audio element
    const audio = document.getElementById('remote-audio');
    if (audio) audio.remove();

    txLed.classList.remove('active-tx');
    rxLed.classList.remove('active-rx');
}

// ============================================================
// UI HELPERS
// ============================================================

function setStatus(text, className) {
    statusBadge.textContent = text;
    statusBadge.className = `status-badge ${className}`;
}

function showActiveChannel(code) {
    channelControls.style.display = 'none';
    channelActive.style.display = 'flex';
    activeCode.textContent = code;
}

// ============================================================
// START THE APP
// ============================================================

init();
