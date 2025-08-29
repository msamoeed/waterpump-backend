# Memory Optimization Guide for Water Pump Backend

## 🚨 Critical Issue: JavaScript Heap Out of Memory

Your application is experiencing JavaScript heap out of memory errors when processing large datasets from InfluxDB. This guide provides solutions to prevent and resolve these issues.

## 🔧 Immediate Solutions

### 1. Restart Your Containers with Memory Limits

```bash
# Stop current containers
docker-compose down

# Start with memory-optimized configuration
docker-compose up -d
```

### 2. Use the Memory Optimization Script

```bash
# Make script executable
chmod +x memory-optimization.sh

# Check current memory usage
./memory-optimization.sh check

# Monitor memory continuously
./memory-optimization.sh monitor

# Restart API if memory is high
./memory-optimization.sh restart
```

## 📊 Memory Configuration

### Docker Memory Limits

The updated `docker-compose.yml` includes:

- **API Container**: 3GB memory limit, 1GB reservation
- **InfluxDB**: 2GB memory limit, 1GB reservation  
- **PostgreSQL**: 1GB memory limit, 512MB reservation
- **Redis**: 512MB memory limit, 256MB reservation

### Node.js Memory Options

```bash
NODE_OPTIONS="--max-old-space-size=2048 --max-semi-space-size=512"
```

- `--max-old-space-size=2048`: Sets heap size to 2GB
- `--max-semi-space-size=512`: Sets semi-space size to 512MB

## 🚀 Code Optimizations

### 1. Paginated Queries

Use the new pagination parameters in your API calls:

```typescript
// Before (causes memory issues)
const data = await influxService.queryHistoricalData(deviceId, 'water_levels', startTime, endTime);

// After (memory efficient)
const result = await influxService.queryHistoricalData(
  deviceId, 
  'water_levels', 
  startTime, 
  endTime, 
  '1h',  // aggregate window
  1000,  // limit per page
  0      // offset
);

// Access paginated data
const { data, total, hasMore } = result;
```

### 2. Streaming Large Datasets

For very large datasets, use the streaming method:

```typescript
// Stream data in chunks without loading everything into memory
for await (const chunk of influxService.streamHistoricalData(
  deviceId, 
  'water_levels', 
  startTime, 
  endTime, 
  '1h',    // aggregate window
  1000     // chunk size
)) {
  // Process each chunk
  await processDataChunk(chunk);
}
```

### 3. Get Record Count First

Check data volume before processing:

```typescript
const totalRecords = await influxService.getRecordCount(
  deviceId, 
  'water_levels', 
  startTime, 
  endTime
);

if (totalRecords > 100000) {
  // Use streaming for large datasets
  // Or implement pagination
}
```

## 📈 Monitoring and Prevention

### 1. Health Check Endpoint

Your API now includes a health check at `/health` that monitors:
- Memory usage
- Database connections
- Service status

### 2. Memory Monitoring

```bash
# Check container memory usage
docker stats

# Monitor specific container
docker stats waterpump-api

# Use the optimization script
./memory-optimization.sh monitor
```

### 3. Automatic Restart

The script can automatically restart the API container when memory usage exceeds 2.5GB:

```bash
./memory-optimization.sh restart
```

## 🛠️ Production Deployment

### 1. Use Production Configuration

```bash
# Deploy with production settings
docker-compose -f docker-compose.prod.yml up -d
```

Production configuration includes:
- Stricter memory limits
- Health checks
- Optimized Node.js flags
- Nginx reverse proxy

### 2. Environment Variables

Set appropriate environment variables:

```bash
# .env file
NODE_ENV=production
NODE_OPTIONS="--max-old-space-size=1536 --max-semi-space-size=256 --optimize-for-size"
```

## 🔍 Troubleshooting

### 1. Check Memory Usage

```bash
# Container memory
docker stats --no-stream

# System memory
free -h

# Process memory
ps aux | grep node
```

### 2. Analyze Memory Leaks

```bash
# Check for memory leaks in logs
docker logs waterpump-api | grep -i "memory\|heap\|gc"

# Monitor garbage collection
docker exec waterpump-api node --trace-gc -e "console.log('GC monitoring enabled')"
```

### 3. Database Query Optimization

- Use appropriate time ranges
- Implement aggregation windows
- Avoid `SELECT *` queries
- Use indexes on time and device_id columns

## 📋 Best Practices

### 1. API Design

- Always implement pagination for data endpoints
- Use appropriate default limits (1000-10000 records)
- Provide total count and hasMore flags
- Implement rate limiting for large queries

### 2. Data Processing

- Process data in chunks
- Use streaming for large datasets
- Implement timeouts for long-running operations
- Cache frequently accessed data

### 3. Monitoring

- Set up memory usage alerts
- Monitor query performance
- Track API response times
- Log memory usage regularly

## 🚨 Emergency Procedures

### 1. Immediate Memory Issue

```bash
# Stop the API container
docker stop waterpump-api

# Check what's consuming memory
docker stats --no-stream

# Restart with memory limits
docker-compose up -d api
```

### 2. Persistent Memory Issues

```bash
# Clean up Docker system
./memory-optimization.sh cleanup

# Restart all services
docker-compose down && docker-compose up -d

# Check logs for errors
docker-compose logs api
```

## 📞 Support

If you continue to experience memory issues:

1. Check the logs: `docker-compose logs api`
2. Monitor memory: `./memory-optimization.sh monitor`
3. Review your query patterns and time ranges
4. Consider implementing data archiving for old records

## 🔄 Regular Maintenance

```bash
# Weekly memory check
./memory-optimization.sh check

# Monthly cleanup
./memory-optimization.sh cleanup

# Monitor during peak usage times
./memory-optimization.sh monitor
```

---

**Remember**: The key to preventing memory issues is implementing proper pagination, using streaming for large datasets, and monitoring memory usage regularly.
