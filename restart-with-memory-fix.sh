#!/bin/bash

# Quick Restart Script with Memory Fixes
# This script will restart your water pump backend with memory optimizations

set -e

echo "🚀 Quick Restart with Memory Fixes"
echo "=================================="

# Stop all containers
echo "🛑 Stopping all containers..."
docker-compose down

# Clean up any hanging processes
echo "🧹 Cleaning up Docker system..."
docker system prune -f

# Start with memory-optimized configuration
echo "🚀 Starting containers with memory limits..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 15

# Check container status
echo "📊 Checking container status..."
docker-compose ps

# Check memory usage
echo "💾 Checking memory usage..."
docker stats --no-stream --format "table {{.Container}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}"

echo ""
echo "✅ Restart completed with memory optimizations!"
echo ""
echo "🔧 Next steps:"
echo "1. Monitor memory usage: ./memory-optimization.sh monitor"
echo "2. Check API health: curl http://localhost:3002/health"
echo "3. Review the MEMORY_OPTIMIZATION_GUIDE.md for best practices"
echo ""
echo "📊 To monitor continuously:"
echo "   ./memory-optimization.sh monitor"
echo ""
echo "🔄 To restart API if memory gets high:"
echo "   ./memory-optimization.sh restart"
