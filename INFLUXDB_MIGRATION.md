# InfluxDB Migration Guide: 2.x to 3.0

## 🚀 Overview

This guide will help you upgrade your water pump system from InfluxDB 2.x to InfluxDB 3.0, which provides better performance and SQL support.

## 📋 Prerequisites

- Docker and Docker Compose installed
- Current system running on InfluxDB 2.x
- Backup of important data (recommended)

## 🔄 Migration Steps

### 1. Automatic Migration (Recommended)

Run the automated migration script:

```bash
cd backend
./migrate-influxdb.sh
```

This script will:
- Stop current containers
- Backup your existing InfluxDB data
- Remove old InfluxDB 2.x container and volume
- Start InfluxDB 3.0
- Start the API with updated configuration

### 2. Manual Migration

If you prefer manual migration:

```bash
# Stop current containers
docker-compose down

# Backup data (optional)
docker run --rm -v waterpump_influxdb_data:/data -v $(pwd):/backup alpine tar czf /backup/influxdb_backup_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .

# Remove old volume
docker-compose down -v
docker volume rm waterpump_influxdb_data

# Start new InfluxDB 3.0
docker-compose up -d influxdb

# Wait for InfluxDB to be ready (30 seconds)
sleep 30

# Start API
docker-compose up -d api
```

## 🧪 Testing the Migration

After migration, test your setup:

```bash
./test-influxdb3.sh
```

This will test:
- InfluxDB 3.0 health
- SQL query endpoints
- Time series data endpoints
- System stats endpoints

## 🔧 What's New in InfluxDB 3.0

### ✅ Benefits
- **SQL Support**: Native SQL queries instead of Flux
- **Better Performance**: Optimized for time-series data
- **Improved Scalability**: Better handling of large datasets
- **Enhanced Security**: Improved authentication and authorization

### 🔄 Backward Compatibility
- **Dual Client Support**: The system now uses both InfluxDB 2.x and 3.0 clients
- **Fallback Mechanism**: If SQL queries fail, it automatically falls back to Flux queries
- **Data Compatibility**: Existing data structure is maintained

## 📊 API Endpoints

### New SQL Debug Endpoint
```
GET /devices/debug/sql
```
Tests SQL queries directly with InfluxDB 3.0

### Enhanced Time Series Endpoint
```
GET /devices/{deviceId}/timeseries
```
Now uses SQL queries with fallback to Flux

### System Stats
```
GET /devices/stats
```
Shows system status including InfluxDB connection

## 🐛 Troubleshooting

### Common Issues

1. **Connection Errors**
   ```bash
   # Check InfluxDB logs
   docker-compose logs influxdb
   
   # Check API logs
   docker-compose logs api
   ```

2. **Data Not Appearing**
   - InfluxDB 3.0 starts with a fresh database
   - Historical data needs to be migrated if required
   - Check backup files for data restoration

3. **SQL Query Errors**
   - The system automatically falls back to Flux queries
   - Check logs for specific error messages
   - Verify InfluxDB 3.0 is running: `curl http://localhost:8087/health`

### Restore Data (If Needed)

If you need to restore data from backup:

```bash
# Extract backup
tar -xzf influxdb_backup_YYYYMMDD_HHMMSS.tar.gz

# Copy to InfluxDB volume (requires manual steps)
# Contact support for detailed restoration process
```

## 📈 Performance Improvements

With InfluxDB 3.0, you should see:
- **Faster Query Response**: SQL queries are optimized
- **Better Memory Usage**: Improved resource management
- **Enhanced Scalability**: Better handling of concurrent requests

## 🔒 Security Notes

- InfluxDB 3.0 uses the same token-based authentication
- Environment variables remain the same
- No additional security configuration required

## 📞 Support

If you encounter issues:
1. Check the logs: `docker-compose logs`
2. Run the test script: `./test-influxdb3.sh`
3. Verify InfluxDB health: `curl http://localhost:8087/health`

## 🎉 Migration Complete!

Your water pump system is now running on InfluxDB 3.0 with:
- ✅ SQL query support
- ✅ Fallback to Flux queries
- ✅ Improved performance
- ✅ Better scalability
- ✅ Enhanced security

Enjoy the improved performance and SQL capabilities! 