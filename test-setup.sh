#!/bin/bash

echo "🚀 Anti-Cheating Video Conference Setup Test"
echo "=============================================="

# Check Node.js version
echo "📋 Checking Node.js version..."
node_version=$(node --version 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Node.js: $node_version"
else
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Not in project root directory"
    exit 1
fi

echo "✅ In project root directory"

# Check if server directory exists
if [ ! -d "server" ]; then
    echo "❌ Server directory not found"
    exit 1
fi

# Check if client directory exists
if [ ! -d "client" ]; then
    echo "❌ Client directory not found"
    exit 1
fi

echo "✅ Project structure looks good"

# Check if dependencies are installed
echo "📦 Checking dependencies..."

if [ ! -d "node_modules" ]; then
    echo "⚠️  Root dependencies not installed. Run: npm install"
fi

if [ ! -d "server/node_modules" ]; then
    echo "⚠️  Server dependencies not installed. Run: cd server && npm install"
fi

if [ ! -d "client/node_modules" ]; then
    echo "⚠️  Client dependencies not installed. Run: cd client && npm install"
fi

echo ""
echo "🎯 Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Start development: npm run dev"
echo "3. Open browser to: http://localhost:5173"
echo ""
echo "📱 For phone testing:"
echo "- Use the same signaling URL and room name"
echo "- Ensure all devices are on the same Wi-Fi network"
echo ""
echo "🔧 Troubleshooting:"
echo "- Check browser console for errors"
echo "- Verify camera/microphone permissions"
echo "- Check firewall settings for port 3001"
