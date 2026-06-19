# 📻 P2P Radio - WebRTC Walkie-Talkie

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-ISC-green.svg)
![WebRTC](https://img.shields.io/badge/WebRTC-Enabled-orange.svg)
![Android](https://img.shields.io/badge/platform-Android%20%7C%20Web-lightgrey.svg)

**A peer-to-peer voice communication app using WebRTC**  
*Direct audio streaming with push-to-talk functionality*

[Features](#-features) • [Demo](#-demo) • [Installation](#-installation) • [Usage](#-usage) • [Download APK](#-download-apk)

</div>

---

## 🎯 Overview

P2P Radio is a modern walkie-talkie application that enables **direct peer-to-peer voice communication** over the internet. No central media server needed - audio flows directly between users using WebRTC technology.

### ✨ Key Highlights

- 🔐 **Privacy-First**: Direct P2P connection, no audio stored on servers
- 🌍 **Works Everywhere**: Cross-network communication (Wi-Fi, 4G, 5G, different countries)
- ⚡ **Low Latency**: Optimized for real-time voice (<300ms)
- 📱 **Cross-Platform**: Web browser + Android app (iOS coming soon)
- 🎙️ **Push-to-Talk**: Classic walkie-talkie experience
- 🔊 **Roger Beep**: Audio feedback on PTT release

---

## 🚀 Features

### Core Functionality
- ✅ **1-to-1 Voice Communication** - Direct peer-to-peer audio streaming
- ✅ **Channel System** - Create/join channels with short memorable codes (e.g., `ALFA12`)
- ✅ **Push-to-Talk (PTT)** - Hold button to transmit, release to listen
- ✅ **Real-Time Stats** - TX/RX counters and latency display
- ✅ **Connection Quality Monitor** - Visual signal strength meter
- ✅ **NAT Traversal** - Works through firewalls using STUN/TURN servers

### Technical Features
- 🎤 **High-Quality Audio**: 24kHz mono with echo cancellation, noise suppression, and auto gain control
- 🔄 **Automatic Reconnection**: Handles network drops gracefully
- 📊 **WebRTC Stats API**: Real-time connection quality metrics
- 🎨 **Radio-Themed UI**: Vintage walkie-talkie aesthetic
- 📱 **Mobile-Optimized**: Touch-friendly interface with pointer events

---

## 🎬 Demo

### Web Application
![P2P Radio Interface](https://via.placeholder.com/800x400?text=P2P+Radio+Interface)

### How It Works
```
┌─────────────┐                  ┌──────────────┐                  ┌─────────────┐
│   User A    │◄────WebSocket───►│   Signaling  │◄────WebSocket───►│   User B    │
│  (Browser)  │                  │    Server    │                  │  (Browser)  │
└─────────────┘                  └──────────────┘                  └─────────────┘
       │                         (Coordination)                            │
       │                                                                   │
       └──────────────────────WebRTC P2P Audio─────────────────────────────┘
                              (Direct Connection)
```

---

## 📦 Installation

### Prerequisites
- **Node.js** 18+ (for signaling server)
- **Modern Browser** (Chrome, Edge, Firefox, Safari)
- **Android Studio** (optional, for APK building)

### Quick Start

1. **Clone the Repository**
   ```bash
   git clone https://github.com/umer-80/Walkie-Talkie-Radio.git
   cd Walkie-Talkie-Radio
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Start the Signaling Server**
   ```bash
   npm start
   ```
   Server will run on `ws://localhost:3000`

4. **Open the Web App**
   ```bash
   # Option 1: Direct file access
   open index.html
   
   # Option 2: Local HTTP server (recommended)
   python3 -m http.server 8080
   # Then visit: http://localhost:8080
   ```

---

## 🎮 Usage

### Creating a Channel

1. Open the app in your browser
2. Allow microphone access when prompted
3. Click **"📻 CREATE CHANNEL"**
4. Share the generated code (e.g., `BRAVO23`) with your partner
5. Wait for them to join

### Joining a Channel

1. Get the channel code from your partner
2. Enter it in the input field
3. Click **"JOIN"**
4. Wait for connection to establish

### Talking

1. Once connected, the **PTT button** (red circle) becomes active
2. **Hold down** the PTT button while speaking
3. **Release** to stop transmitting (you'll hear a roger beep)
4. Watch the **TX/RX indicators** to see transmission status

---

## 📱 Download APK

### Latest Release

Get the latest Android APK from the [Releases Page](https://github.com/umer-80/Walkie-Talkie-Radio/releases)

Or download the artifact from the latest GitHub Actions build:
1. Go to [Actions](https://github.com/umer-80/Walkie-Talkie-Radio/actions)
2. Click the latest successful workflow run
3. Download `P2P-Radio-Debug-APK.zip`
4. Extract and install `app-debug.apk` on your Android device

### Building APK Locally

```bash
# Sync Capacitor
npx cap sync android

# Open in Android Studio
npx cap open android

# Or build via command line
cd android
./gradlew assembleDebug

# APK location: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🏗️ Architecture

### Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | Vanilla JS + HTML5 + CSS3 | Lightweight, no framework overhead |
| **WebRTC** | RTCPeerConnection API | Peer-to-peer audio streaming |
| **Signaling** | Node.js + WebSocket (ws) | Channel coordination |
| **Audio** | Web Audio API | Roger beep, audio processing |
| **Mobile** | Capacitor v8 | Android wrapper |
| **STUN/TURN** | Google STUN + openrelay.metered.ca | NAT traversal |

### Project Structure

```
.
├── index.html              # Main web app
├── main.js                 # WebRTC logic + UI
├── style.css               # Radio-themed styling
├── server.js               # Signaling server
├── package.json            # Dependencies
├── capacitor.config.json   # Capacitor config
├── www/                    # Compiled web assets
│   ├── index.html
│   ├── main.js
│   └── style.css
├── android/                # Android project
│   └── app/
│       └── src/main/
│           ├── AndroidManifest.xml
│           └── java/com/p2p/radio/MainActivity.java
└── .github/workflows/
    └── android_build.yml   # APK build automation
```

---

## 🔧 Configuration

### Signaling Server URL

Edit in `index.html` or `www/index.html`:

```javascript
// For local testing
window.SIGNALING_URL = 'ws://localhost:3000';

// For production deployment
window.SIGNALING_URL = 'wss://your-server.com';
```

### Audio Settings

Modify in `main.js` (line ~86):

```javascript
localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 24000,  // Change to 16000 or 48000 if needed
        channelCount: 1      // Mono audio
    }
});
```

### STUN/TURN Servers

Update in `main.js` (line ~24):

```javascript
const ICE_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Add your own TURN server here
        {
            urls: 'turn:your-turn-server.com:3478',
            username: 'your-username',
            credential: 'your-password'
        }
    ]
};
```

---

## 🐛 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **"Not connected to signaling server"** | Ensure `npm start` is running. Check WebSocket URL. |
| **"Microphone permission denied"** | Click browser's lock icon → Allow microphone → Refresh page |
| **"No audio received"** | Both users must grant mic permission. Hold PTT while talking. |
| **"Connection failed"** | Try Chrome/Edge (best WebRTC support). Check firewall settings. |
| **APK installation blocked** | Enable "Install from unknown sources" in Android settings |

### Debug Mode

Open browser console (F12) to see detailed logs:
- `✅` = Success messages
- `❌` = Error messages
- WebRTC connection states
- ICE candidate gathering
- Audio track states

### Test Connection

Open `test-connection.html` for diagnostics:
- WebSocket connectivity test
- Microphone access test  
- WebRTC support check

---

## 🚢 Deployment

### Deploy Signaling Server

#### Option 1: Render.com (Free)
1. Create new Web Service
2. Connect your GitHub repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add environment variable: `PORT=10000`

#### Option 2: Railway.app
```bash
railway login
railway init
railway up
```

#### Option 3: Fly.io
```bash
fly launch
fly deploy
```

After deployment, update `SIGNALING_URL` in your HTML files to use `wss://` (not `ws://`).

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -m 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Open a Pull Request

---

## 📝 Roadmap

- [ ] Multi-user channels (3+ participants)
- [ ] QR code channel sharing
- [ ] Voice Activity Detection (hands-free mode)
- [ ] End-to-end encryption
- [ ] Session persistence (localStorage)
- [ ] iOS app (via Capacitor)
- [ ] Wi-Fi Direct support (offline mode)
- [ ] Recording functionality

---

## 📄 License

ISC License - see [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

- **WebRTC** - Real-time communication technology
- **Google STUN Servers** - NAT traversal
- **Open Relay Project** - Free TURN servers
- **Capacitor** - Cross-platform mobile framework

---

## 📧 Contact

**GitHub**: [@umer-80](https://github.com/umer-80)  
**Project**: [Walkie-Talkie-Radio](https://github.com/umer-80/Walkie-Talkie-Radio)

---

<div align="center">

**⭐ Star this repo if you find it useful!**

Made with ❤️ using WebRTC

</div>
