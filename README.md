# 📻 P2P Walkie-Talkie Radio

A real-time, peer-to-peer (P2P) Walkie-Talkie application built with WebRTC, Node.js, and Capacitor. 

## 📖 The Story & Inspiration
In today's hyper-connected world, we often take network infrastructure for granted. But what happens when you are in an environment where standard communication drops? This project began as an exploration into real-time, decentralized communication. The goal was to build a highly private, low-latency communication tool that operates without relying heavily on massive corporate servers. 

Currently, this project serves as an advanced portfolio piece demonstrating complex WebRTC peer-to-peer audio streaming across local networks. However, the inspiration and learnings from this project are the foundation for something much bigger that is currently in secret development (see [Future Plans](#-future-plans)).

## 🚀 Current Features
- **Real-Time P2P Audio:** Low-latency audio streaming using WebRTC.
- **Cross-Platform:** Works natively in modern web browsers and as an Android APK (via Capacitor).
- **God-Level Privacy:** Audio streams directly from device to device. The signaling server is only used for the initial handshake and does not process or record audio.
- **Group Channels:** Secure channel codes allow multiple users to tune into the same frequency.

## 🛠️ Technical Complications Conquered
Building a WebRTC app for both Desktop and Android involved solving severe security "Catch-22s", specifically on Android WebViews:
1. **The PNA (Private Network Access) Block:** Modern browsers block local applications from talking to local network IP addresses to prevent malicious attacks.
2. **The Secure Context Paradox:** Android completely disables the Microphone (`getUserMedia`) unless the app is hosted on a "Secure Context" (`https://` or `localhost`).
3. **The Solution:** We successfully navigated this by hosting the Capacitor app natively on `localhost` to retain microphone access, while utilizing Android's `usesCleartextTraffic` permissions to allow the WebSocket signaling server handshake to bypass the PNA block.

## 🏗️ How to Run Locally
1. Clone the repository and install dependencies: `npm install`
2. Start the local signaling server: `node server.js` (runs on port 3000).
3. **Important for Mobile Testing:** If testing the APK across multiple phones on your Wi-Fi network, ensure your computer's firewall is open to port 3000 (e.g., `sudo ufw allow 3000/tcp` on Ubuntu).
4. Run the web client or build the APK via Capacitor.

## 🔮 Future Plans: The "Next Evolution"
This WebRTC implementation is just Phase 1. The ultimate vision for this project transcends standard Wi-Fi networks. 

The future evolution involves transitioning from WebRTC to **True Off-Grid Mesh Networking**. By utilizing native hardware protocols, the next iteration will allow devices to form invisible, decentralized communication chains. This will enable secure, serverless communication in environments completely devoid of traditional network infrastructure.
