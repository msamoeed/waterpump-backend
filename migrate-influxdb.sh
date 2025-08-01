#!/bin/bash

echo "🚀 InfluxDB Migration Script - 2.x to 3.0"
echo "=========================================="

# Check if running in Docker
if [ -f /.dockerenv ]; then
    echo "❌ This script should be run on the host machine, not inside Docker"
    exit 1
fi

# Stop the current containers
echo "📦 Stopping current containers..."
docker-compose down

# Backup current InfluxDB data
echo "💾 Creating backup of current InfluxDB data..."
docker run --rm -v waterpump_influxdb_data:/data -v $(pwd):/backup alpine tar czf /backup/influxdb_backup_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .

# Remove the old InfluxDB container and volume
echo "🗑️  Removing old InfluxDB container and volume..."
docker-compose down -v
docker volume rm waterpump_influxdb_data 2>/dev/null || true

# Start the new InfluxDB 3.0
echo "🔄 Starting InfluxDB 3.0..."
docker-compose up -d influxdb

# Wait for InfluxDB to be ready
echo "⏳ Waiting for InfluxDB 3.0 to be ready..."
sleep 30

# Check if InfluxDB is running
echo "🔍 Checking InfluxDB 3.0 status..."
if curl -s http://localhost:8087/health > /dev/null; then
    echo "✅ InfluxDB 3.0 is running successfully!"
else
    echo "❌ InfluxDB 3.0 failed to start. Check logs with: docker-compose logs influxdb"
    exit 1
fi

# Start the API
echo "🚀 Starting the API..."
docker-compose up -d api

echo "✅ Migration completed!"
echo ""
echo "📋 Next steps:"
echo "1. Check the API logs: docker-compose logs -f api"
echo "2. Test the endpoints:"
echo "   - GET http://localhost:3002/devices/debug/sql"
echo "   - GET http://localhost:3002/devices/esp32_controller_001/timeseries"
echo "3. If you need to restore data, check the backup file: influxdb_backup_*.tar.gz"
echo ""
echo "🔧 If you encounter issues:"
echo "   - Check logs: docker-compose logs"
echo "   - Restart services: docker-compose restart"
echo "   - Rebuild: docker-compose up --build" 