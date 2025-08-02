#!/bin/bash

echo "🚀 Server Migration Script - InfluxDB 2.x to 3.3 Core"
echo "====================================================="

# Configuration
SERVER_HOST="your-server-ip-or-domain"
SERVER_USER="your-username"
REMOTE_PATH="/path/to/your/waterpump/project"
BACKUP_PATH="/backup/waterpump-$(date +%Y%m%d_%H%M%S)"

echo "📋 Configuration:"
echo "  Server: $SERVER_HOST"
echo "  User: $SERVER_USER"
echo "  Remote Path: $REMOTE_PATH"
echo "  Backup Path: $BACKUP_PATH"
echo ""

# Step 1: Backup current server data
echo "💾 Step 1: Creating backup of current server data..."
ssh $SERVER_USER@$SERVER_HOST << EOF
    mkdir -p $BACKUP_PATH
    cd $REMOTE_PATH/backend
    
    # Stop current containers
    docker-compose down
    
    # Backup InfluxDB data
    docker run --rm -v waterpump_influxdb_data:/data -v $BACKUP_PATH:/backup alpine tar czf /backup/influxdb_backup.tar.gz -C /data .
    
    # Backup docker-compose files
    cp docker-compose.yml $BACKUP_PATH/
    cp .env $BACKUP_PATH/ 2>/dev/null || echo "No .env file found"
    
    echo "✅ Backup completed to $BACKUP_PATH"
EOF

# Step 2: Upload updated files
echo "📤 Step 2: Uploading updated files to server..."
scp -r ../backend $SERVER_USER@$SERVER_HOST:$REMOTE_PATH/

# Step 3: Run migration on server
echo "🔄 Step 3: Running migration on server..."
ssh $SERVER_USER@$SERVER_HOST << EOF
    cd $REMOTE_PATH/backend
    
    # Make scripts executable
    chmod +x migrate-influxdb.sh
    chmod +x test-influxdb3.sh
    
    # Run the migration
    ./migrate-influxdb.sh
    
    # Test the migration
    ./test-influxdb3.sh
EOF

echo ""
echo "✅ Server migration completed!"
echo ""
echo "📋 Next steps:"
echo "1. Verify the migration: ssh $SERVER_USER@$SERVER_HOST"
echo "2. Check logs: cd $REMOTE_PATH/backend && docker-compose logs"
echo "3. Test endpoints: curl http://$SERVER_HOST:3002/api/v1/devices/debug/sql"
echo "4. Monitor performance and data integrity"
echo ""
echo "🔧 If you need to rollback:"
echo "  - Backup is available at: $BACKUP_PATH"
echo "  - Restore: docker-compose down && restore from backup" 