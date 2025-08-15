# Sensor Monitoring System

## Overview

The sensor monitoring system automatically controls the roof pump based on sensor connectivity and functionality. When either the ground tank sensor or roof tank sensor goes offline or stops working, the system automatically pauses the roof pump until both sensors are working again.

**All operations use WebSocket events for real-time communication with the mobile app and frontend.**

## Features

### Automatic Pump Control
- **Sensor Offline Detection**: Monitors both ground and roof tank sensors every 10 seconds
- **Automatic Pause**: Pauses the roof pump when either sensor is offline or not working
- **Automatic Resume**: Resumes the roof pump when both sensors are working again
- **Smart Recovery**: Remembers the previous pump state and restores it after sensor recovery

### Real-time WebSocket Events
The system emits real-time events via WebSocket for immediate frontend updates:

- `sensor_monitoring_update`: Real-time sensor status and pump state
- `pump_paused_sensor`: Notification when pump is paused due to sensor issues
- `pump_resumed_sensor`: Notification when pump resumes after sensor recovery
- `sensor_override_update`: Status changes for manual overrides
- `system_alert`: System-wide alerts for sensor issues

### Manual Override
- **Temporary Override**: Disable sensor monitoring for up to 24 hours
- **Manual Control**: Force sensor status checks
- **Audit Trail**: All override actions are logged with reasons

## WebSocket Events

### Client to Server Events (Mobile App → Backend)

#### Get Sensor Status
```javascript
socket.emit('get_sensor_status', 'esp32_controller_001');
```

#### Override Sensor Monitoring
```javascript
socket.emit('override_sensor_monitoring', {
  device_id: 'esp32_controller_001',
  enable: true,
  reason: 'Maintenance work'
});
```

#### Force Sensor Check
```javascript
socket.emit('force_sensor_check', 'esp32_controller_001');
```

### Server to Client Events (Backend → Mobile App)

#### Sensor Status Response
```json
{
  "event": "sensor_status_response",
  "data": {
    "success": true,
    "data": {
      "device_id": "esp32_controller_001",
      "sensor_monitoring_active": true,
      "is_overridden": false,
      "pause_status": null,
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

#### Sensor Override Response
```json
{
  "event": "sensor_override_response",
  "data": {
    "success": true,
    "message": "Sensor monitoring overridden successfully",
    "data": {
      "device_id": "esp32_controller_001",
      "override_enabled": true,
      "reason": "Maintenance work",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

#### Sensor Check Response
```json
{
  "event": "sensor_check_response",
  "data": {
    "success": true,
    "message": "Sensor status check completed successfully",
    "data": {
      "device_id": "esp32_controller_001",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

### Real-time Monitoring Events

#### Sensor Monitoring Update
```json
{
  "event": "sensor_monitoring_update",
  "data": {
    "device_id": "esp32_controller_001",
    "ground_sensor": {
      "connected": true,
      "working": true
    },
    "roof_sensor": {
      "connected": true,
      "working": true
    },
    "pump_status": {
      "running": false,
      "paused_by_sensor": false
    },
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Pump Paused Event
```json
{
  "event": "pump_paused_sensor",
  "data": {
    "device_id": "esp32_controller_001",
    "reason": "Sensor offline - Ground: OFFLINE, Roof: OK",
    "sensor_status": {
      "groundSensorConnected": false,
      "roofSensorConnected": true,
      "groundSensorWorking": false,
      "roofSensorWorking": true
    },
    "timestamp": "2024-01-15T10:30:00.000Z",
    "action": "paused"
  }
}
```

## Configuration

### Monitoring Intervals
- **Sensor Check**: Every 10 seconds
- **Offline Threshold**: 30 seconds before considering sensor offline
- **Override TTL**: 24 hours for manual overrides
- **Pause State TTL**: 1 hour for tracking paused states

### Sensor Requirements
Both sensors must meet these criteria for the pump to run:
1. **Connected**: Sensor is communicating with the system
2. **Working**: Sensor is providing valid readings

## Frontend Integration

### Subscribe to Events
```javascript
// Subscribe to device-specific sensor updates
socket.emit('subscribe_device', 'esp32_controller_001');

// Listen for sensor monitoring updates
socket.on('sensor_monitoring_update', (data) => {
  console.log('Sensor status:', data);
  updateSensorStatus(data);
});

// Listen for pump control events
socket.on('pump_paused_sensor', (data) => {
  console.log('Pump paused:', data);
  showPumpPausedAlert(data);
});

socket.on('pump_resumed_sensor', (data) => {
  console.log('Pump resumed:', data);
  showPumpResumedAlert(data);
});
```

### Manual Override Control
```javascript
// Enable sensor monitoring override
socket.emit('override_sensor_monitoring', {
  device_id: 'esp32_controller_001',
  enable: true,
  reason: 'Maintenance work'
});

// Listen for override response
socket.on('sensor_override_response', (data) => {
  if (data.success) {
    console.log('Override enabled:', data.message);
  } else {
    console.error('Override failed:', data.error);
  }
});

// Force sensor status check
socket.emit('force_sensor_check', 'esp32_controller_001');

// Listen for check response
socket.on('sensor_check_response', (data) => {
  if (data.success) {
    console.log('Sensor check completed:', data.message);
  } else {
    console.error('Sensor check failed:', data.error);
  }
});
```

### Get Current Sensor Status
```javascript
// Request current sensor status
socket.emit('get_sensor_status', 'esp32_controller_001');

// Listen for status response
socket.on('sensor_status_response', (data) => {
  if (data.success) {
    const status = data.data;
    console.log('Sensor monitoring active:', status.sensor_monitoring_active);
    console.log('Override enabled:', status.is_overridden);
    console.log('Pause status:', status.pause_status);
  } else {
    console.error('Failed to get sensor status:', data.error);
  }
});
```

## Safety Features

### Protection Mechanisms
- **Automatic Pause**: Prevents pump operation with unreliable sensor data
- **State Memory**: Remembers pump state before sensor issues
- **Override Limits**: 24-hour maximum for manual overrides
- **Audit Logging**: All actions are logged for safety and compliance

### Error Handling
- **Graceful Degradation**: System continues monitoring even if some components fail
- **Fallback States**: Uses cached data when sensors are temporarily unavailable
- **Recovery Logic**: Automatic recovery when sensors come back online

## Monitoring and Alerts

### Event Logging
All sensor monitoring events are logged to PostgreSQL with appropriate severity levels:
- **Info**: Normal sensor status updates
- **Warning**: Sensor connectivity issues
- **High**: Pump paused due to sensor issues
- **Critical**: Multiple sensor failures

### Push Notifications
The system integrates with OneSignal to send push notifications for:
- Sensor offline events
- Pump pause/resume actions
- Manual override changes

## Troubleshooting

### Common Issues

1. **Pump Not Starting After Sensor Recovery**
   - Check if sensor monitoring is overridden
   - Verify both sensors are connected and working
   - Check event logs for error messages

2. **False Sensor Offline Alerts**
   - Verify sensor communication intervals
   - Check network connectivity
   - Review sensor offline threshold settings

3. **Override Not Working**
   - Check override TTL (24 hours)
   - Verify override was properly set
   - Check event logs for override actions

### Debug Information
Enable debug logging to see detailed sensor monitoring information:
```bash
# Check sensor monitoring logs
docker logs waterpump-api | grep "Sensor monitoring"

# Check WebSocket connections
docker logs waterpump-api | grep "WebSocket"
```

## Future Enhancements

### Planned Features
- **Configurable Thresholds**: Adjustable sensor offline thresholds per device
- **Advanced Override Rules**: Time-based and condition-based overrides
- **Sensor Health Metrics**: Long-term sensor reliability tracking
- **Predictive Maintenance**: Alert before sensors fail based on patterns

### Integration Points
- **Dashboard Widgets**: Real-time sensor status display
- **Mobile App**: Push notifications and manual control
- **Analytics**: Sensor reliability reports and trends
- **API Extensions**: Third-party integration capabilities
