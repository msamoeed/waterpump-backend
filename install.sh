#!/bin/bash

echo "🚀 Setting up Water Pump Backend System..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm version: $(npm -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Create environment file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
    echo "✅ .env file created. Please edit it with your configuration."
else
    echo "✅ .env file already exists"
fi

# Check if Docker is installed
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "✅ Docker and Docker Compose are available"
    echo "🐳 You can start the complete stack with: docker-compose up -d"
else
    echo "⚠️  Docker not found. You'll need to install and configure databases manually:"
    echo "   - PostgreSQL: https://www.postgresql.org/download/"
    echo "   - Redis: https://redis.io/download"
    echo "   - InfluxDB: https://portal.influxdata.com/downloads/"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your database configuration"
echo "2. Start databases (PostgreSQL, Redis, InfluxDB)"
echo "3. Run: npm run start:dev"
echo ""
echo "Or use Docker:"
echo "docker-compose up -d"
echo ""
echo "API will be available at: http://localhost:3000"
echo "WebSocket will be available at: ws://localhost:3000" 