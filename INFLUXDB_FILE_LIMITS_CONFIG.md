# InfluxDB File Limits Configuration

## Overview

InfluxDB 3.x has a default limit on the number of parquet files that can be accessed in a single query (default: 432 files). When this limit is exceeded, you'll see the error:

```
RpcError: Error while planning query: External error: Query would exceed file limit of 432 parquet files. 
Please specify a smaller time range for your query.
```

## Solution: Automatic Query Chunking

The backend now automatically handles large time ranges by chunking them into smaller segments to avoid hitting file limits.

## Environment Variables

Add these to your `.env` file:

```bash
# Maximum number of parquet files per query (default: 1000)
INFLUXDB_MAX_FILE_LIMIT=1000

# Default chunk size for large queries in hours (default: 6)
INFLUXDB_CHUNK_SIZE_HOURS=6
```

## Recommended Time Range Limits

| Query Type | Max Time Range | Use Case |
|------------|----------------|----------|
| real-time  | 1 hour         | Live monitoring, dashboards |
| daily      | 6 hours        | Daily analysis, reports |
| weekly     | 24 hours       | Weekly trends, patterns |
| monthly    | 72 hours       | Monthly analysis |
| custom     | Configurable    | Based on INFLUXDB_CHUNK_SIZE_HOURS |

## How It Works

1. **Automatic Detection**: When a query exceeds 6 hours, it's automatically chunked
2. **Smart Chunking**: Large queries are split into 6-hour segments
3. **Adaptive Reduction**: If file limits are still hit, chunks are reduced to 3 hours, then 1 hour
4. **Error Handling**: File limit errors are caught and handled gracefully
5. **Result Aggregation**: All chunk results are combined into a single response

## API Endpoints

### Check File Limits Configuration
```bash
GET /devices/debug/file-limits
```

### Validate Time Range
```bash
GET /devices/debug/validate-time-range?startTime=2024-01-01T00:00:00Z&endTime=2024-01-02T00:00:00Z&queryType=daily
```

## Performance Considerations

- **Smaller chunks** = Better performance, fewer file limit issues
- **Larger chunks** = Fewer queries, but may hit file limits
- **Aggregation** = Use `aggregateWindow` parameter to reduce data volume

## Example Usage

### Before (May hit file limits)
```typescript
// Query 24 hours of data
const data = await influxService.queryHistoricalData(
  'device_001',
  'water_levels',
  '2024-01-01T00:00:00Z',
  '2024-01-02T00:00:00Z'
);
```

### After (Automatically chunked)
```typescript
// Same query, automatically chunked into 6-hour segments
const data = await influxService.queryHistoricalData(
  'device_001',
  'water_levels',
  '2024-01-01T00:00:00Z',
  '2024-01-02T00:00:00Z'
);
// Result: Automatically split into 4 chunks of 6 hours each
```

## Troubleshooting

### Still hitting file limits?
1. Reduce `INFLUXDB_CHUNK_SIZE_HOURS` to 3 or 1
2. Use smaller time ranges in your queries
3. Enable aggregation with `aggregateWindow` parameter
4. Check if your data has high write frequency (more files created)

### Performance issues?
1. Increase `INFLUXDB_CHUNK_SIZE_HOURS` if your hardware can handle it
2. Use aggregation to reduce data volume
3. Consider data retention policies to reduce file count

## Server Configuration

If you want to increase the server-side file limit (not recommended for production):

```bash
# Start InfluxDB with higher file limit
influxd serve --query-file-limit 1000
```

**Warning**: Higher limits may cause OOM issues and unstable performance.
