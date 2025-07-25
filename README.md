# Water Pump Backend System

A comprehensive IoT backend system for water level monitoring and pump control, built with Nest.js, TypeScript, and multiple databases.

## 🏗️ Architecture

This backend implements a multi-database architecture optimized for IoT data:

- **InfluxDB**: Time-series data storage for sensor readings and metrics
- **Redis**: Real-time caching and message queuing
- **PostgreSQL**: Configuration, metadata, and structured data
- **WebSocket**: Real-time communication with frontend clients

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- PostgreSQL, Redis, and InfluxDB (or use Docker)

### Installation

1. **Clone and install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Start with Docker (recommended):**
   ```bash
   docker-compose up -d
   ```

4. **Or start manually:**
   ```bash
   # Start databases first
   # Then start the API
   npm run start:dev
   ```

## 📊 API Endpoints

### Device Status Updates
- `POST /api/v1/devices/status/update` - Update device status
- `POST /api/v1/devices/events/pump` - Handle pump events

### Device Queries
- `GET /api/v1/devices/status` - Get all devices status
- `GET /api/v1/devices/:deviceId/status` - Get specific device status
- `GET /api/v1/devices/:deviceId/history` - Get historical data

### System Information
- `GET /api/v1/devices/system/stats` - Get system statistics

## 🔌 WebSocket Events

### Client to Server
- `subscribe_device` - Subscribe to device updates
- `get_current_status` - Request current device status

### Server to Client
- `device_update` - Real-time device status updates
- `pump_event` - Pump state change events
- `alert_triggered` - System alerts and notifications
- `device_offline` - Device connectivity events

## 🗄️ Database Schema

### InfluxDB Measurements

**water_levels**
- Tags: device_id, tank_id (ground/roof)
- Fields: level_percent, level_inches, alarm_active, connected, sensor_working

**pump_metrics**
- Tags: device_id
- Fields: current_amps, power_watts, running, protection_active, runtime_minutes

**system_events**
- Tags: device_id, event_type, severity
- Fields: description

### PostgreSQL Tables

**devices**
- device_id, name, location, tank_capacity_liters, pump_max_current

**alert_rules**
- device_id, condition_type, threshold_value, alert_message, enabled

**event_log**
- device_id, event_type, message, severity, timestamp

### Redis Keys

- `device:{deviceId}:status` - Current device status (TTL: 5min)
- `alerts:active:{deviceId}` - Active alerts (TTL: 1hour)
- `pump:runtime:{deviceId}:{date}` - Daily pump runtime

## 🔧 Configuration

### Environment Variables

```env
# Application
NODE_ENV=development
PORT=3000

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DB=waterpump

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# InfluxDB
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your-token
INFLUXDB_ORG=your-org
INFLUXDB_BUCKET=waterpump
```

## 📈 Data Flow

1. **ESP32 sends status** → HTTP POST to `/api/v1/devices/status/update`
2. **Data processing** → Parallel storage in InfluxDB, Redis, and PostgreSQL
3. **Alert checking** → Automatic alert generation based on thresholds
4. **Real-time updates** → WebSocket broadcast to connected clients
5. **Historical queries** → InfluxDB time-series queries with aggregation

## 🚨 Alert System

### Automatic Alerts
- **Sensor offline**: When tank sensors lose connection
- **Low water**: When tank levels fall below thresholds
- **Pump protection**: When protection systems activate
- **Overcurrent**: When pump current exceeds limits

### Alert Processing
1. Store in PostgreSQL event log
2. Cache active alerts in Redis
3. Broadcast via WebSocket
4. Support alert escalation and notifications

## 🔍 Monitoring

### System Health
- Database connection status
- WebSocket client count
- API response times
- Data ingestion rates

### Performance Metrics
- Query response times
- Cache hit rates
- Database storage usage
- Real-time event processing

## 🛠️ Development

### Scripts
```bash
npm run start:dev    # Development with hot reload
npm run build        # Build for production
npm run start:prod   # Start production build
npm run test         # Run tests
npm run lint         # Lint code
```

### Database Setup
```bash
# PostgreSQL
createdb waterpump

# InfluxDB (via web UI at http://localhost:8086)
# Create organization: waterpump-org
# Create bucket: waterpump
# Generate token and update .env

# Redis
# No setup required, runs on default port
```

## 🐳 Docker Deployment

### Production Setup
```bash
# Build and start all services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View logs
docker-compose logs -f api

# Scale API instances
docker-compose up -d --scale api=3

# With environment variables
POSTGRES_PASSWORD=secure_password INFLUXDB_TOKEN=your_token docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Health Checks
```bash
# Check API health
curl http://localhost:3000/api/v1/health

# Check database connections
curl http://localhost:3000/api/v1/system/stats
```

## 🔒 Security

- Input validation with class-validator
- CORS configuration
- Rate limiting (recommended for production)
- Environment-based configuration
- Database connection security

## 🛠️ Troubleshooting

### Docker Build Issues
If you encounter Docker build failures:

1. **Clear Docker cache:**
   ```bash
   docker system prune -a
   ```

2. **Rebuild without cache:**
   ```bash
   docker-compose build --no-cache
   ```

3. **Check Node.js version compatibility:**
   ```bash
   node --version  # Should be 18+
   ```

### Database Connection Issues
1. **Check database services are running:**
   ```bash
   docker-compose ps
   ```

2. **Check database logs:**
   ```bash
   docker-compose logs postgres
   docker-compose logs redis
   docker-compose logs influxdb
   ```

3. **Verify environment variables:**
   ```bash
   docker-compose exec api env | grep -E "(POSTGRES|REDIS|INFLUXDB)"
   ```

### API Health Checks
```bash
# Check API health
curl http://localhost:3000/api/v1/health

# Check database health
curl http://localhost:3000/api/v1/health/databases

# Check WebSocket connection
wscat -c ws://localhost:3000
```

## 📝 API Documentation

### Device Status Update Example
```json
{
  "device_id": "esp32_controller_001",
  "timestamp": 1703123456789,
  "ground_tank": {
    "level_percent": 45.2,
    "level_inches": 12.5,
    "alarm_active": false,
    "connected": true,
    "sensor_working": true,
    "water_supply_on": false
  },
  "roof_tank": {
    "level_percent": 78.9,
    "level_inches": 25.3,
    "alarm_active": false,
    "connected": true,
    "sensor_working": true,
    "water_supply_on": true
  },
  "pump": {
    "running": true,
    "manual_override": false,
    "current_amps": 5.2,
    "power_watts": 1196.0,
    "daily_consumption": 2.4,
    "hourly_consumption": 0.1,
    "runtime_minutes": 45,
    "total_runtime_hours": 12,
    "protection_active": false,
    "overcurrent_protection": false,
    "overtime_protection": false
  },
  "system": {
    "auto_mode_enabled": true,
    "manual_pump_control": false,
    "water_supply_active": true
  }
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details 