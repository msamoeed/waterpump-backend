# InfluxDB 3.3 Core Setup Guide

## 🎉 Successfully Migrated to InfluxDB 3.3 Core!

Your water pump system is now running on **InfluxDB 3.3 Core** with full SQL support and improved performance.

## ✅ What's Working

### 1. **InfluxDB 3.3 Core Configuration**
- ✅ Running on port 8087 (mapped from container port 8181)
- ✅ No authentication mode enabled (`--without-auth`)
- ✅ Database `waterpump` created and ready
- ✅ File-based storage configured

### 2. **Client Library Support**
- ✅ Using `@influxdata/influxdb3-client@1.2.0`
- ✅ Full support for InfluxDB 3.3 Core
- ✅ SQL query support
- ✅ Point-based data writing
- ✅ Proper error handling

### 3. **API Integration**
- ✅ NestJS backend connected successfully
- ✅ SQL debug endpoint working
- ✅ Data writing and querying functional
- ✅ Health checks passing

### 4. **Data Operations**
- ✅ Writing water level data
- ✅ Writing pump metrics
- ✅ Writing system events
- ✅ SQL queries for historical data
- ✅ Real-time data access

## 🔧 Configuration Details

### Docker Compose Setup
```yaml
influxdb:
  image: influxdb:3.3-core
  command: >
    influxdb3
    serve
    --node-id=node0
    --object-store=file
    --data-dir=/var/lib/influxdb3/data
    --plugin-dir=/var/lib/influxdb3/plugins
    --without-auth
  ports:
    - "8087:8181"
```

### Environment Variables
```bash
INFLUXDB_URL=http://influxdb:8181
INFLUXDB_TOKEN=dummy-token-for-no-auth-mode
INFLUXDB_BUCKET=waterpump
```

### Client Configuration
```typescript
const client = new InfluxDBClient({
  host: 'http://localhost:8087',
  database: 'waterpump',
  token: 'dummy-token-for-no-auth-mode'
});
```

## 📊 Data Structure

### Water Levels Measurement
```typescript
Point.measurement('water_levels')
  .setTag('device_id', deviceId)
  .setTag('tank_id', 'ground' | 'roof')
  .setFloatField('level_percent', number)
  .setFloatField('level_inches', number)
  .setBooleanField('alarm_active', boolean)
  .setBooleanField('connected', boolean)
  .setBooleanField('sensor_working', boolean)
  .setBooleanField('water_supply_on', boolean)
  .setTimestamp(date)
```

### Pump Metrics Measurement
```typescript
Point.measurement('pump_metrics')
  .setTag('device_id', deviceId)
  .setFloatField('current_amps', number)
  .setFloatField('power_watts', number)
  .setFloatField('daily_consumption', number)
  .setFloatField('hourly_consumption', number)
  .setBooleanField('running', boolean)
  .setBooleanField('protection_active', boolean)
  .setIntegerField('runtime_minutes', number)
  .setIntegerField('total_runtime_hours', number)
  .setTimestamp(date)
```

## 🚀 API Endpoints

### Health Check
```bash
GET http://localhost:3002/api/v1/health
```

### SQL Debug
```bash
GET http://localhost:3002/api/v1/devices/debug/sql
```

### Device Status Update
```bash
POST http://localhost:3002/api/v1/devices/status/update
```

## 🧪 Testing

### Run System Tests
```bash
cd backend
./test-influxdb3.sh
```

### Test Data Writing
```bash
node test-water-supply-simple.js
```

### Manual Health Check
```bash
curl http://localhost:8087/health
```

## 🔍 Troubleshooting

### Common Issues

1. **"No token specified" Error**
   - Solution: Use `dummy-token-for-no-auth-mode` for development
   - InfluxDB 3.x requires a token even in no-auth mode

2. **"Database not found" Error**
   - Solution: Create database manually:
   ```bash
   docker exec waterpump-influxdb influxdb3 create database waterpump
   ```

3. **"Table not found" Error**
   - Solution: Send some data first to create measurements
   - Tables are created automatically when data is written

4. **Connection Issues**
   - Check if containers are running: `docker-compose ps`
   - Check logs: `docker-compose logs influxdb`
   - Verify port mapping: `8087:8181`

## 📈 Performance Benefits

With InfluxDB 3.3 Core, you now have:

- **Native SQL Support**: No more Flux queries needed
- **Better Performance**: Optimized for time-series data
- **Improved Scalability**: Better handling of large datasets
- **Enhanced Security**: Future-ready for authentication
- **Modern Architecture**: Latest InfluxDB technology

## 🔄 Migration from 2.x

The migration from InfluxDB 2.x to 3.3 Core included:

1. ✅ Updated Docker image to `influxdb:3.3-core`
2. ✅ Changed client library to `@influxdata/influxdb3-client`
3. ✅ Updated Point creation syntax
4. ✅ Modified SQL queries for 3.x compatibility
5. ✅ Configured no-auth mode for development
6. ✅ Updated API endpoints and error handling

## 🎯 Next Steps

1. **Production Deployment**
   - Enable authentication for production
   - Configure proper tokens
   - Set up monitoring and alerts

2. **Data Migration** (if needed)
   - Export data from old InfluxDB 2.x
   - Import to InfluxDB 3.3 Core
   - Verify data integrity

3. **Performance Optimization**
   - Monitor query performance
   - Optimize data retention policies
   - Configure proper indexing

## 📞 Support

If you encounter any issues:

1. Check the logs: `docker-compose logs`
2. Run the test script: `./test-influxdb3.sh`
3. Verify InfluxDB health: `curl http://localhost:8087/health`
4. Check API health: `curl http://localhost:3002/api/v1/health`

---

**🎉 Congratulations! Your water pump system is now running on InfluxDB 3.3 Core with full SQL support!** 