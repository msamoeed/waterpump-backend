#!/bin/bash

# Log Management Script for Water Pump Backend
# This script helps manage logs and prevent buffer memory buildup

echo "📝 Water Pump Backend Log Management Script"
echo "==========================================="

# Function to check current log sizes
check_logs() {
    echo "📊 Current Log Sizes:"
    docker system df
    echo ""
    echo "📋 Container Logs:"
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep waterpump
    echo ""
    echo "🗂️  Log File Sizes:"
    find . -name "*.log" -type f -exec ls -lh {} \; 2>/dev/null || echo "No log files found in current directory"
}

# Function to clean up logs
cleanup_logs() {
    echo "🧹 Cleaning up logs..."
    
    # Clean up Docker logs
    docker system prune -f
    
    # Clean up container logs
    docker container prune -f
    
    # Clean up image logs
    docker image prune -f
    
    # Clean up volume logs
    docker volume prune -f
    
    # Clean up network logs
    docker network prune -f
    
    echo "✅ Log cleanup completed"
}

# Function to restart with log rotation
restart_with_log_rotation() {
    echo "🔄 Restarting services with log rotation..."
    
    # Stop services
    docker-compose down
    
    # Clean up logs
    cleanup_logs
    
    # Start services with log rotation
    docker-compose up -d
    
    echo "✅ Services restarted with log rotation enabled"
}

# Function to monitor log memory usage
monitor_log_memory() {
    echo "📈 Monitoring log memory usage (Press Ctrl+C to stop)..."
    watch -n 10 'docker system df && echo "" && docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" | grep waterpump'
}

# Function to set log levels
set_log_level() {
    local level=${1:-warn}
    echo "🔧 Setting log level to: $level"
    
    # Update environment variables
    export LOG_LEVEL=$level
    
    # Restart API service with new log level
    docker-compose stop api
    docker-compose up -d api
    
    echo "✅ Log level set to $level and API restarted"
}

# Function to show current log configuration
show_log_config() {
    echo "⚙️  Current Log Configuration:"
    echo "   - LOG_LEVEL: ${LOG_LEVEL:-warn}"
    echo "   - LOG_BUFFER_SIZE: ${LOG_BUFFER_SIZE:-1000}"
    echo "   - LOG_FLUSH_INTERVAL: ${LOG_FLUSH_INTERVAL:-5000}"
    echo "   - Docker log max-size: 10m"
    echo "   - Docker log max-files: 5"
    echo ""
    echo "📋 Available log levels: error, warn, log, debug, verbose"
}

# Main menu
case "${1:-}" in
    "check")
        check_logs
        ;;
    "cleanup")
        cleanup_logs
        ;;
    "restart")
        restart_with_log_rotation
        ;;
    "monitor")
        monitor_log_memory
        ;;
    "level")
        set_log_level "$2"
        ;;
    "config")
        show_log_config
        ;;
    *)
        echo "Usage: $0 {check|cleanup|restart|monitor|level|config}"
        echo ""
        echo "Commands:"
        echo "  check     - Check current log sizes and usage"
        echo "  cleanup   - Clean up all logs and unused resources"
        echo "  restart   - Restart services with log rotation"
        echo "  monitor   - Monitor log memory usage in real-time"
        echo "  level     - Set log level (e.g., $0 level warn)"
        echo "  config    - Show current log configuration"
        echo ""
        echo "Examples:"
        echo "  $0 check"
        echo "  $0 cleanup"
        echo "  $0 level error"
        echo "  $0 monitor"
        ;;
esac
