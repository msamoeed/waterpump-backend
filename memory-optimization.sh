#!/bin/bash

# Memory Optimization Script for Water Pump Backend
# This script helps monitor and optimize memory usage

set -e

echo "🔧 Water Pump Backend Memory Optimization Script"
echo "================================================"

# Function to check container memory usage
check_memory_usage() {
    echo "📊 Checking container memory usage..."
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
    echo ""
}

# Function to restart API container if memory usage is high
restart_if_high_memory() {
    echo "🔄 Checking if API container needs restart due to high memory usage..."
    
    # Get memory usage in MB
    MEMORY_USAGE=$(docker stats --no-stream --format "{{.MemUsage}}" waterpump-api | grep -oE '[0-9]+\.?[0-9]*' | head -1)
    
    if [ ! -z "$MEMORY_USAGE" ] && (( $(echo "$MEMORY_USAGE > 2500" | bc -l) )); then
        echo "⚠️  High memory usage detected: ${MEMORY_USAGE}MB"
        echo "🔄 Restarting API container..."
        docker restart waterpump-api
        echo "✅ API container restarted"
        sleep 10
        check_memory_usage
    else
        echo "✅ Memory usage is normal: ${MEMORY_USAGE}MB"
    fi
}

# Function to clean up Docker system
cleanup_docker() {
    echo "🧹 Cleaning up Docker system..."
    docker system prune -f
    echo "✅ Docker cleanup completed"
}

# Function to show memory optimization tips
show_tips() {
    echo "💡 Memory Optimization Tips:"
    echo "1. Use pagination in API calls (limit parameter)"
    echo "2. Implement data streaming for large datasets"
    echo "3. Set appropriate time ranges for queries"
    echo "4. Use aggregation windows to reduce data volume"
    echo "5. Monitor memory usage regularly"
    echo "6. Restart containers if memory usage exceeds 2.5GB"
}

# Function to monitor memory continuously
monitor_memory() {
    echo "📈 Starting continuous memory monitoring (Ctrl+C to stop)..."
    echo ""
    
    while true; do
        clear
        echo "🕐 $(date)"
        echo "📊 Container Memory Usage:"
        docker stats --no-stream --format "table {{.Container}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}"
        echo ""
        echo "💾 System Memory:"
        free -h
        echo ""
        echo "Press Ctrl+C to stop monitoring"
        sleep 30
    done
}

# Main menu
case "${1:-}" in
    "check")
        check_memory_usage
        ;;
    "restart")
        restart_if_high_memory
        ;;
    "cleanup")
        cleanup_docker
        ;;
    "monitor")
        monitor_memory
        ;;
    "tips")
        show_tips
        ;;
    *)
        echo "Usage: $0 {check|restart|cleanup|monitor|tips}"
        echo ""
        echo "Commands:"
        echo "  check    - Check current memory usage"
        echo "  restart  - Restart API if memory is high"
        echo "  cleanup  - Clean up Docker system"
        echo "  monitor  - Start continuous monitoring"
        echo "  tips     - Show optimization tips"
        echo ""
        echo "Examples:"
        echo "  $0 check"
        echo "  $0 monitor"
        echo "  $0 restart"
        ;;
esac
