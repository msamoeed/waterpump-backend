# InfluxDB 3.3 File Limit Guide

## 🚨 Critical Issue: Query File Limit Exceeded

Your InfluxDB 3.3 queries are failing with this error:
```
Error while planning query: External error: Query would exceed file limit of 432 parquet files. 
Please specify a smaller time range for your query. You can increase the file limit with the 
`--query-file-limit` option in the serve command, however, query performance will be slower 
and the server may get OOM killed or become unstable as a result
```

## 🔧 Immediate Solutions

### 1. Restart with Increased File Limits

```bash
# Stop current containers
docker-compose down

# Start with updated configuration (already applied)
docker-compose up -d
```

The updated `docker-compose.yml` now includes:
```yaml
influxdb:
  command: >
    influxdb3
    serve
    --node-id=node0
    --object-store=file
    --data-dir=/var/lib/influxdb3/data
    --plugin-dir=/var/lib/influxdb3/plugins
    --without-auth
    --query-file-limit=1000          # Increased from 432
    --query-memory-bytes=1073741824  # 1GB memory limit
    --query-concurrency-limit=4      # Limit concurrent queries
```

### 2. Use the Memory Optimization Script

```bash
# Check current memory usage
./memory-optimization.sh check

# Monitor memory continuously
./memory-optimization.sh monitor
```

## 📊 Understanding the File Limit Issue

### What Causes It?

- **Large Time Ranges**: Queries spanning days/weeks access many parquet files
- **High Data Volume**: Many data points create many storage files
- **No Aggregation**: Raw data queries vs. aggregated summaries
- **Concurrent Queries**: Multiple large queries running simultaneously

### Why It Happens?

InfluxDB 3.3 stores data in parquet files, and each query must scan all relevant files. Large time ranges mean more files, which can exceed the default limit.

## 🚀 Code-Level Solutions

### 1. Automatic Time Range Limiting

The updated service automatically limits queries to 24 hours:

```typescript
// ✅ AUTOMATIC: Service limits time ranges to prevent file limit issues
const result = await influxService.queryHistoricalData(
  deviceId, 
  'water_levels', 
  startTime,    // Will be limited to 24 hours if too large
  endTime, 
  '1h',         // Use aggregation to reduce file access
  1000,         // Limit records per page
  0             // Offset
);
```

### 2. Use Aggregation Windows

Aggregation reduces the number of files accessed:

```typescript
// ✅ GOOD: Aggregated data (fewer files)
const hourlyData = await influxService.queryHistoricalData(
  deviceId, 'water_levels', startTime, endTime, '1h'
);

// ❌ BAD: Raw data (many files)
const rawData = await influxService.queryHistoricalData(
  deviceId, 'water_levels', startTime, endTime
);
```

### 3. Streaming for Large Datasets

The service automatically splits large time ranges:

```typescript
// ✅ AUTOMATIC: Service splits large time ranges into chunks
for await (const chunk of influxService.streamHistoricalData(
  deviceId, 'water_levels', startTime, endTime, '1h', 1000
)) {
  await processDataChunk(chunk);
}
```

## 📈 Best Practices

### 1. Time Range Guidelines

| Use Case | Recommended Range | Aggregation |
|----------|------------------|-------------|
| Real-time monitoring | Last 1-4 hours | None or 1m |
| Daily reports | Last 24 hours | 1h |
| Weekly analysis | Last 7 days | 6h or 1d |
| Monthly trends | Last 30 days | 1d |
| Historical analysis | Custom ranges | 1d or 1w |

### 2. Query Patterns

```typescript
// ✅ RECOMMENDED: Small time ranges with aggregation
const recentData = await influxService.queryHistoricalData(
  deviceId, 'water_levels', 
  new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
  new Date().toISOString(),                                  // Now
  '15m'  // 15-minute aggregation
);

// ✅ RECOMMENDED: Use streaming for large ranges
for await (const chunk of influxService.streamHistoricalData(
  deviceId, 'water_levels', 
  '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z', 
  '1d'  // Daily aggregation
)) {
  await processDataChunk(chunk);
}
```

### 3. Error Handling

The service now provides clear error messages:

```typescript
try {
  const data = await influxService.queryHistoricalData(deviceId, 'water_levels', startTime, endTime);
} catch (error) {
  if (error.message.includes('file limit')) {
    // Handle file limit error
    console.log('Use smaller time range or aggregation window');
  }
}
```

## 🛠️ Configuration Options

### Docker Compose Settings

```yaml
influxdb:
  command: >
    influxdb3
    serve
    --query-file-limit=1000          # Increase file limit
    --query-memory-bytes=1073741824  # 1GB per query
    --query-concurrency-limit=4      # Max concurrent queries
    --max-concurrent-compactions=2   # Limit background tasks
```

### Environment Variables

```bash
# .env file
INFLUXDB_QUERY_FILE_LIMIT=1000
INFLUXDB_QUERY_MEMORY_BYTES=1073741824
INFLUXDB_QUERY_CONCURRENCY_LIMIT=4
```

## 🔍 Monitoring and Prevention

### 1. Health Checks

```bash
# Check InfluxDB health
curl http://localhost:8087/health

# Check API health
curl http://localhost:3002/api/v1/health

# Monitor container resources
docker stats waterpump-influxdb
```

### 2. Query Performance Monitoring

```typescript
// Add timing to your queries
const startTime = Date.now();
const data = await influxService.queryHistoricalData(/* ... */);
const queryTime = Date.now() - startTime;

if (queryTime > 5000) { // 5 seconds
  console.warn('Slow query detected. Consider using aggregation or smaller time ranges.');
}
```

### 3. Automatic Alerts

The service now logs warnings for large queries:

```
[WARNING] Time range too large: 168 hours. Limiting to 24 hours.
[WARNING] Large dataset detected: 150000 records. Consider using aggregation window.
```

## 🚨 Emergency Procedures

### 1. Immediate File Limit Issue

```bash
# Stop the API container to prevent more queries
docker stop waterpump-api

# Check InfluxDB status
docker-compose logs influxdb

# Restart with increased limits
docker-compose up -d
```

### 2. Persistent Issues

```bash
# Clean restart
docker-compose down
docker system prune -f
docker-compose up -d

# Check logs
docker-compose logs influxdb
```

### 3. Data Cleanup (if needed)

```bash
# Access InfluxDB shell
docker exec -it waterpump-influxdb influxdb3

# Check database size
SHOW DATABASES;

# Check measurements
USE waterpump;
SHOW MEASUREMENTS;
```

## 📋 Testing Your Fixes

### 1. Test with Small Time Ranges

```bash
# Test syntax with small ranges
node test-influxdb3-syntax.js

# Test system functionality
./test-influxdb3.sh
```

### 2. Test Aggregation

```typescript
// Test hourly aggregation
const hourlyData = await influxService.queryHistoricalData(
  'esp32_controller_001', 
  'water_levels', 
  new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
  new Date().toISOString(),                                   // Now
  '1h'  // Hourly aggregation
);
```

### 3. Test Streaming

```typescript
// Test streaming for large ranges
for await (const chunk of influxService.streamHistoricalData(
  'esp32_controller_001', 
  'water_levels', 
  '2025-01-01T00:00:00Z', 
  '2025-01-07T23:59:59Z', 
  '1d'  // Daily aggregation
)) {
  console.log(`Processing chunk with ${chunk.length} records`);
}
```

## 🎯 Success Metrics

After implementing these fixes, you should see:

- ✅ **No more file limit errors**
- ✅ **Faster query performance**
- ✅ **Lower memory usage**
- ✅ **Better system stability**
- ✅ **Automatic time range limiting**
- ✅ **Intelligent query splitting**

## 📞 Support

If you continue to experience file limit issues:

1. **Check the logs**: `docker-compose logs influxdb`
2. **Monitor resources**: `docker stats waterpump-influxdb`
3. **Test with small ranges**: Use the test script
4. **Use aggregation**: Always specify time windows
5. **Consider data retention**: Archive old data if needed

---

**🎉 With these fixes, your InfluxDB 3.3 system should handle large datasets efficiently without file limit errors!**
