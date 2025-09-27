#!/bin/bash

# Install dependencies for both server and client
echo "Installing server dependencies..."
cd server && npm install

echo "Installing client dependencies..."
cd ../client && npm install

echo "Installing root dependencies..."
cd .. && npm install

echo "All dependencies installed!"
echo ""
echo "To start development servers:"
echo "npm run dev"
echo ""
echo "This will start:"
echo "- Server on http://localhost:3001"
echo "- Client on http://localhost:5173"
