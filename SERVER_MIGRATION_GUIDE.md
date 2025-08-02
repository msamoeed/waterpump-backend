# Server Migration Guide: InfluxDB 2.x to 3.3 Core

## 🚀 Overview

This guide will help you migrate your water pump system from InfluxDB 2.x to InfluxDB 3.3 Core on your production server.

## 📋 Prerequisites

- SSH access to your server
- Docker and Docker Compose installed on server
- Backup of current production data (recommended)
- Server downtime window (15-30 minutes)

## 🔄 Migration Steps

### Step 1: Prepare Your Local Environment

1. **Update the server migration script:**
   ```bash
   # Edit server-migration.sh with your server details
   nano server-migration.sh
   ```

2. **Update these variables:**
   ```bash
   SERVER_HOST="your-server-ip-or-domain"
   SERVER_USER="your-username"
   REMOTE_PATH="/path/to/your/waterpump/project"
   ```

### Step 2: Backup Current Server Data

**Option A: Using the automated script**
```bash
./server-migration.sh
```

**Option B: Manual backup**
```bash
# SSH to your server
ssh your-username@your-server-ip

# Navigate to your project
cd /path/to/your/waterpump/backend

# Stop current containers
docker-compose down

# Create backup directory
mkdir -p /backup/waterpump-$(date +%Y%m%d_%H%M%S)

# Backup InfluxDB data
docker run --rm -v waterpump_influxdb_data:/data -v /backup/waterpump-$(date +%Y%m%d_%H%M%S):/backup alpine tar czf /backup/influxdb_backup.tar.gz -C /data .

# Backup configuration files
cp docker-compose.yml /backup/waterpump-$(date +%Y%m%d_%H%M%S)/
cp .env /backup/waterpump-$(date +%Y%m%d_%H%M%S)/ 2>/dev/null || echo "No .env file"
```

### Step 3: Upload Updated Files

**Option A: Using SCP**
```bash
# From your local machine
scp -r ../backend your-username@your-server-ip:/path/to/your/waterpump/
```

**Option B: Using Git**
```bash
# On your server
cd /path/to/your/waterpump
git pull origin main  # or your deployment branch
```

### Step 4: Run Migration on Server

```bash
# SSH to your server
ssh your-username@your-server-ip

# Navigate to backend directory
cd /path/to/your/waterpump/backend

# Make scripts executable
chmod +x migrate-influxdb.sh
chmod +x test-influxdb3.sh

# Run the migration
./migrate-influxdb.sh

# Test the migration
./test-influxdb3.sh
```

### Step 5: Verify Migration

```bash
# Check if containers are running
docker-compose ps

# Check InfluxDB logs
docker-compose logs influxdb

# Check API logs
docker-compose logs api

# Test endpoints
curl http://your-server-ip:3002/api/v1/devices/debug/sql
curl http://your-server-ip:3002/api/v1/devices/esp32_controller_001/timeseries
```

## 🔧 Manual Migration (If Automated Script Fails)

### 1. Stop Current Services
```bash
docker-compose down
```

### 2. Remove Old InfluxDB Container and Volume
```bash
docker-compose down -v
docker volume rm waterpump_influxdb_data
```

### 3. Start InfluxDB 3.3 Core
```bash
docker-compose up -d influxdb
```

### 4. Wait for InfluxDB to Start
```bash
# Wait 30 seconds
sleep 30

# Check if it's running
docker-compose logs influxdb --tail=10
```

### 5. Create Database and Token
```bash
# Create database
docker exec -it waterpump-influxdb influxdb3 create database waterpump

# Create admin token
docker exec -it waterpump-influxdb influxdb3 create token --admin
```

### 6. Update Environment Variables
```bash
# Set the token in your environment
export INFLUXDB_TOKEN="your-generated-token"

# Or update your .env file
echo "INFLUXDB_TOKEN=your-generated-token" >> .env
```

### 7. Start API
```bash
docker-compose up -d api
```

### 8. Test Everything
```bash
./test-influxdb3.sh
```

## 🐛 Troubleshooting

### Common Issues

1. **Permission Denied**
   ```bash
   # Fix volume permissions
   docker-compose down
   sudo chown -R 1000:1000 /path/to/influxdb/data
   docker-compose up -d influxdb
   ```

2. **Port Already in Use**
   ```bash
   # Check what's using the port
   sudo netstat -tulpn | grep :8087
   
   # Kill the process or change port in docker-compose.yml
   ```

3. **Database Connection Errors**
   ```bash
   # Check if database exists
   docker exec -it waterpump-influxdb influxdb3 show databases
   
   # Create database if missing
   docker exec -it waterpump-influxdb influxdb3 create database waterpump
   ```

4. **Token Authentication Issues**
   ```bash
   # Regenerate token
   docker exec -it waterpump-influxdb influxdb3 create token --admin
   
   # Update environment variable
   export INFLUXDB_TOKEN="new-token"
   docker-compose restart api
   ```

### Rollback Procedure

If something goes wrong:

```bash
# Stop new containers
docker-compose down

# Restore old docker-compose.yml
cp /backup/waterpump-YYYYMMDD_HHMMSS/docker-compose.yml .

# Restore InfluxDB data (if needed)
docker run --rm -v waterpump_influxdb_data:/data -v /backup/waterpump-YYYYMMDD_HHMMSS:/backup alpine tar xzf /backup/influxdb_backup.tar.gz -C /data

# Start old version
docker-compose up -d
```

## 📊 Post-Migration Verification

### 1. Check All Services
```bash
docker-compose ps
```

### 2. Test API Endpoints
```bash
# Health check
curl http://your-server-ip:3002/api/v1/health

# SQL debug
curl http://your-server-ip:3002/api/v1/devices/debug/sql

# Time series data
curl http://your-server-ip:3002/api/v1/devices/esp32_controller_001/timeseries
```

### 3. Monitor Logs
```bash
# Watch logs for errors
docker-compose logs -f

# Check specific service logs
docker-compose logs influxdb
docker-compose logs api
```

### 4. Performance Check
```bash
# Check resource usage
docker stats

# Test query performance
time curl http://your-server-ip:3002/api/v1/devices/esp32_controller_001/timeseries
```

## 🔒 Security Considerations

1. **Update Firewall Rules**
   ```bash
   # Ensure port 8181 is accessible for InfluxDB 3.3 Core
   sudo ufw allow 8181
   ```

2. **Secure Token Storage**
   ```bash
   # Store token securely
   echo "INFLUXDB_TOKEN=your-token" | sudo tee -a /etc/environment
   ```

3. **Regular Backups**
   ```bash
   # Set up automated backups
   crontab -e
   # Add: 0 2 * * * /path/to/backup-script.sh
   ```

## 📈 Performance Monitoring

### 1. Monitor Query Performance
```bash
# Check query response times
curl -w "@curl-format.txt" -o /dev/null -s http://your-server-ip:3002/api/v1/devices/esp32_controller_001/timeseries
```

### 2. Monitor Resource Usage
```bash
# Check memory and CPU usage
docker stats --no-stream
```

### 3. Monitor Disk Usage
```bash
# Check InfluxDB data directory
du -sh /var/lib/docker/volumes/waterpump_influxdb_data/_data
```

## 🎉 Migration Complete!

After successful migration, your server will have:

- ✅ InfluxDB 3.3 Core running on port 8181
- ✅ SQL query support
- ✅ Improved performance
- ✅ Better scalability
- ✅ Working time series data endpoints

## 📞 Support

If you encounter issues:

1. Check the logs: `docker-compose logs`
2. Verify configuration: `docker-compose config`
3. Test connectivity: `curl http://localhost:8181/health`
4. Check documentation: [InfluxDB 3.3 Core Docs](https://docs.influxdata.com/influxdb3/core/)

Your water pump system is now running on InfluxDB 3.3 Core with full SQL support! 🚀 