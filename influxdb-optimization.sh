#!/bin/bash

# InfluxDB Optimization Script for Water Pump Backend
# This script helps optimize InfluxDB settings to reduce WAL flushes and memory usage

echo "📊 InfluxDB Optimization Script"
echo "==============================="

# Function to check current InfluxDB status
check_influxdb() {
    echo "🔍 Checking InfluxDB status..."
    
    # Check if InfluxDB is running
    if docker ps | grep -q waterpump-influxdb; then
        echo "✅ InfluxDB is running"
        
        # Check memory usage
        echo "📊 Memory usage:"
        docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" | grep influxdb
        
        # Check logs for WAL activity
        echo "📝 Recent WAL activity:"
        docker logs waterpump-influxdb --tail 20 | grep -i "wal\|flush" || echo "No recent WAL activity found"
    else
        echo "❌ InfluxDB is not running"
    fi
}

# Function to optimize InfluxDB settings
optimize_influxdb() {
    echo "⚙️  Optimizing InfluxDB settings..."
    
    # Stop InfluxDB
    docker-compose stop influxdb
    
    # Wait a moment
    sleep 2
    
    # Start InfluxDB with optimized settings
    docker-compose up -d influxdb
    
    echo "✅ InfluxDB restarted with optimized settings"
    echo "📋 Applied optimizations:"
    echo "   - WAL buffer size: 64MB (dev) / 128MB (prod)"
    echo "   - WAL flush interval: 30s (dev) / 60s (prod)"
    echo "   - WAL max batch size: 1000 (dev) / 2000 (prod)"
    echo "   - Object store cache: 256MB (dev) / 512MB (prod)"
    echo "   - Memory limit: 1GB"
}

# Function to switch to production settings
switch_to_production() {
    echo "🚀 Switching to production InfluxDB settings..."
    
    # Stop all services
    docker-compose down
    
    # Start with production settings
    docker-compose -f docker-compose.prod.yml up -d
    
    echo "✅ Switched to production settings"
    echo "📋 Production optimizations:"
    echo "   - WAL buffer size: 128MB"
    echo "   - WAL flush interval: 60s"
    echo "   - WAL max batch size: 2000"
    echo "   - Object store cache: 512MB"
    echo "   - Memory limit: 1GB"
    echo "   - Max concurrent queries: 32"
}

# Function to monitor WAL activity
monitor_wal() {
    echo "📈 Monitoring WAL activity (Press Ctrl+C to stop)..."
    watch -n 5 'docker logs waterpump-influxdb --tail 10 | grep -i "wal\|flush" || echo "No recent WAL activity"'
}

# Function to show current configuration
show_config() {
    echo "⚙️  Current InfluxDB Configuration:"
    
    if docker ps | grep -q waterpump-influxdb; then
        echo "📋 Running configuration:"
        docker inspect waterpump-influxdb | grep -A 20 "Cmd"
        
        echo ""
        echo "📊 Resource limits:"
        docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" | grep influxdb
    else
        echo "❌ InfluxDB is not running"
    fi
}

# Function to clean up InfluxDB data
cleanup_influxdb() {
    echo "🧹 Cleaning up InfluxDB data..."
    
    read -p "⚠️  This will delete all InfluxDB data. Are you sure? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Stop InfluxDB
        docker-compose stop influxdb
        
        # Remove volume
        docker volume rm waterpump_influxdb_data
        
        # Start fresh
        docker-compose up -d influxdb
        
        echo "✅ InfluxDB data cleaned up and restarted"
    else
        echo "❌ Cleanup cancelled"
    fi
}

# Main menu
case "${1:-}" in
    "check")
        check_influxdb
        ;;
    "optimize")
        optimize_influxdb
        ;;
    "production")
        switch_to_production
        ;;
    "monitor")
        monitor_wal
        ;;
    "config")
        show_config
        ;;
    "cleanup")
        cleanup_influxdb
        ;;
    *)
        echo "Usage: $0 {check|optimize|production|monitor|config|cleanup}"
        echo ""
        echo "Commands:"
        echo "  check      - Check current InfluxDB status and WAL activity"
        echo "  optimize   - Optimize InfluxDB settings for development"
        echo "  production - Switch to production InfluxDB settings"
        echo "  monitor    - Monitor WAL activity in real-time"
        echo "  config     - Show current InfluxDB configuration"
        echo "  cleanup    - Clean up InfluxDB data (⚠️  destructive)"
        echo ""
        echo "Examples:"
        echo "  $0 check"
        echo "  $0 optimize"
        echo "  $0 production"
        echo "  $0 monitor"
        ;;
esac
