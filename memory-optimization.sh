#!/bin/bash

# Memory Optimization Script for Water Pump Backend
# This script helps manage memory usage and restart services with proper settings

echo "🚰 Water Pump Backend Memory Optimization Script"
echo "================================================"

# Function to check current memory usage
check_memory() {
    echo "📊 Current Memory Usage:"
    free -h
    echo ""
    echo "🐳 Docker Memory Usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
    echo ""
}

# Function to restart with memory optimization
restart_with_memory_opt() {
    echo "🔄 Restarting services with memory optimization..."
    
    # Stop all services
    docker-compose down
    
    # Clear any unused containers/images
    docker system prune -f
    
    # Start services with production settings
    docker-compose -f docker-compose.prod.yml up -d
    
    echo "✅ Services restarted with memory optimization"
    echo "📝 Memory settings applied:"
    echo "   - Node.js heap size: 4GB (--max-old-space-size=4096)"
    echo "   - Container memory limits: 2GB"
    echo "   - Container memory reservations: 1GB"
}

# Function to show memory settings
show_settings() {
    echo "⚙️  Current Memory Settings:"
    echo "   - NODE_OPTIONS: $NODE_OPTIONS"
    echo "   - Package.json scripts updated with memory flags"
    echo "   - Docker memory limits configured"
    echo "   - Production docker-compose file created"
}

# Function to monitor memory in real-time
monitor_memory() {
    echo "📈 Monitoring memory usage (Press Ctrl+C to stop)..."
    watch -n 5 'docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"'
}

# Main menu
case "${1:-}" in
    "check")
        check_memory
        ;;
    "restart")
        restart_with_memory_opt
        ;;
    "settings")
        show_settings
        ;;
    "monitor")
        monitor_memory
        ;;
    *)
        echo "Usage: $0 {check|restart|settings|monitor}"
        echo ""
        echo "Commands:"
        echo "  check    - Check current memory usage"
        echo "  restart  - Restart services with memory optimization"
        echo "  settings - Show current memory settings"
        echo "  monitor  - Monitor memory usage in real-time"
        echo ""
        echo "Examples:"
        echo "  $0 check"
        echo "  $0 restart"
        echo "  $0 monitor"
        ;;
esac
