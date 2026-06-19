#!/bin/bash

# P2P Radio Startup Script

echo "🚀 Starting P2P Radio..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the signaling server
echo "📡 Starting signaling server on ws://localhost:3000..."
node server.js &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Check if server is running
if ps -p $SERVER_PID > /dev/null; then
    echo "✅ Signaling server is running (PID: $SERVER_PID)"
else
    echo "❌ Failed to start signaling server"
    exit 1
fi

echo ""
echo "🎉 P2P Radio is ready!"
echo ""
echo "📝 Next steps:"
echo "   1. Open 'index.html' in your browser"
echo "   2. Or run: python3 -m http.server 8080"
echo "   3. Then visit: http://localhost:8080"
echo ""
echo "🧪 To test connection: Open 'test-connection.html'"
echo ""
echo "⏹️  To stop the server, press Ctrl+C"
echo ""

# Keep script running
wait $SERVER_PID
