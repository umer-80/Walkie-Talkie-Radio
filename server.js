/**
 * P2P Radio — Signaling Server
 * 
 * This is a LIGHTWEIGHT WebSocket server. Its ONLY job is to help
 * two users find each other and exchange WebRTC connection info.
 * Once they're connected, this server is NOT involved in the audio at all.
 * 
 * How it works:
 * 1. User A sends "create-channel" → server creates a channel with a short code
 * 2. User B sends "join-channel" with that code → server pairs them
 * 3. Server relays SDP offers/answers/ICE candidates between the pair
 * 4. WebRTC connects them directly (P2P) → server's job is done
 */

const WebSocket = require('ws');

// --- Configuration ---
const PORT = process.env.PORT || 3000;

// --- State ---
// channels = { "KILO7": { creator: ws, joiner: ws | null } }
const channels = {};

// --- Helper: Generate a short, readable channel code ---
function generateChannelCode() {
    // NATO-inspired prefixes + random number = easy to read & share
    const words = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT',
        'GOLF', 'HOTEL', 'INDIA', 'KILO', 'LIMA', 'MIKE',
        'OSCAR', 'PAPA', 'ROMEO', 'SIERRA', 'TANGO', 'VICTOR'];
    const word = words[Math.floor(Math.random() * words.length)];
    const num = Math.floor(Math.random() * 90 + 10); // 10-99
    return `${word}${num}`;
}

// --- Helper: Send JSON to a WebSocket ---
function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// --- Helper: Find the partner in a channel ---
function getPartner(ws) {
    for (const code in channels) {
        const ch = channels[code];
        if (ch.creator === ws) return { partner: ch.joiner, code };
        if (ch.joiner === ws) return { partner: ch.creator, code };
    }
    return { partner: null, code: null };
}

// --- Start WebSocket Server ---
const wss = new WebSocket.Server({ port: PORT });
console.log(`📡 P2P Radio Signaling Server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
    console.log('→ New client connected');

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

            // --- CREATE A NEW CHANNEL ---
            case 'create-channel': {
                let code = generateChannelCode();
                // Make sure code is unique (very unlikely collision, but safe)
                while (channels[code]) code = generateChannelCode();

                channels[code] = { creator: ws, joiner: null };
                ws._channelCode = code; // tag the socket for cleanup
                send(ws, { type: 'channel-created', code });
                console.log(`📻 Channel created: ${code}`);
                break;
            }

            // --- JOIN AN EXISTING CHANNEL ---
            case 'join-channel': {
                const code = (msg.code || '').toUpperCase().trim();
                const ch = channels[code];

                if (!ch) {
                    send(ws, { type: 'error', message: 'Channel not found. Check the code and try again.' });
                    return;
                }
                if (ch.joiner) {
                    send(ws, { type: 'error', message: 'Channel is full. Someone is already connected.' });
                    return;
                }

                ch.joiner = ws;
                ws._channelCode = code;

                // Tell BOTH sides they're paired
                send(ch.creator, { type: 'partner-joined' });
                send(ws, { type: 'joined-channel', code });
                console.log(`🤝 Partner joined channel: ${code}`);
                break;
            }

            // --- RELAY SIGNALING DATA (SDP offer, answer, ICE candidates) ---
            case 'signal': {
                const { partner } = getPartner(ws);
                if (partner) {
                    send(partner, { type: 'signal', data: msg.data });
                }
                break;
            }
        }
    });

    // --- CLEANUP ON DISCONNECT ---
    ws.on('close', () => {
        console.log('← Client disconnected');
        const { partner, code } = getPartner(ws);

        if (code && channels[code]) {
            // Tell partner they disconnected
            if (partner) {
                send(partner, { type: 'partner-left' });
            }
            // Remove the channel
            delete channels[code];
            console.log(`🗑️  Channel ${code} removed`);
        }
    });
});
