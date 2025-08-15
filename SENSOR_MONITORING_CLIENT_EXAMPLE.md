# Sensor Monitoring - Client Implementation Examples

## Overview
This document provides practical examples of how to implement the sensor monitoring system in your mobile app and frontend using WebSocket events.

## Mobile App Implementation (Flutter/Dart)

### 1. WebSocket Connection Setup

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

class SensorMonitoringService {
  late IO.Socket socket;
  
  void connectToWebSocket() {
    socket = IO.io('ws://your-backend-url:3002', <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
    });
    
    socket.connect();
    
    // Subscribe to device
    socket.emit('subscribe_device', 'esp32_controller_001');
    
    // Listen for sensor monitoring events
    _setupEventListeners();
  }
  
  void _setupEventListeners() {
    // Real-time sensor status updates
    socket.on('sensor_monitoring_update', (data) {
      _handleSensorStatusUpdate(data);
    });
    
    // Pump pause/resume events
    socket.on('pump_paused_sensor', (data) {
      _handlePumpPaused(data);
    });
    
    socket.on('pump_resumed_sensor', (data) {
      _handlePumpResumed(data);
    });
    
    // Override status updates
    socket.on('sensor_override_update', (data) {
      _handleOverrideUpdate(data);
    });
    
    // System alerts
    socket.on('system_alert', (data) {
      _handleSystemAlert(data);
    });
  }
}
```

### 2. Get Current Sensor Status

```dart
class SensorMonitoringService {
  Future<Map<String, dynamic>> getSensorStatus(String deviceId) async {
    Completer<Map<String, dynamic>> completer = Completer();
    
    // Listen for response
    socket.once('sensor_status_response', (data) {
      if (data['success']) {
        completer.complete(data['data']);
      } else {
        completer.completeError(data['error']);
      }
    });
    
    // Request status
    socket.emit('get_sensor_status', deviceId);
    
    return completer.future;
  }
  
  // Usage example
  void checkSensorStatus() async {
    try {
      final status = await getSensorStatus('esp32_controller_001');
      print('Sensor monitoring active: ${status['sensor_monitoring_active']}');
      print('Override enabled: ${status['is_overridden']}');
    } catch (e) {
      print('Error getting sensor status: $e');
    }
  }
}
```

### 3. Override Sensor Monitoring

```dart
class SensorMonitoringService {
  Future<bool> overrideSensorMonitoring(String deviceId, bool enable, String reason) async {
    Completer<bool> completer = Completer();
    
    // Listen for response
    socket.once('sensor_override_response', (data) {
      if (data['success']) {
        completer.complete(true);
      } else {
        completer.completeError(data['error']);
      }
    });
    
    // Send override request
    socket.emit('override_sensor_monitoring', {
      'device_id': deviceId,
      'enable': enable,
      'reason': reason,
    });
    
    return completer.future;
  }
  
  // Usage examples
  void enableOverride() async {
    try {
      await overrideSensorMonitoring('esp32_controller_001', true, 'Maintenance work');
      print('Override enabled successfully');
    } catch (e) {
      print('Failed to enable override: $e');
    }
  }
  
  void disableOverride() async {
    try {
      await overrideSensorMonitoring('esp32_controller_001', false, 'Override disabled');
      print('Override disabled successfully');
    } catch (e) {
      print('Failed to disable override: $e');
    }
  }
}
```

### 4. Force Sensor Check

```dart
class SensorMonitoringService {
  Future<bool> forceSensorCheck(String deviceId) async {
    Completer<bool> completer = Completer();
    
    // Listen for response
    socket.once('sensor_check_response', (data) {
      if (data['success']) {
        completer.complete(true);
      } else {
        completer.completeError(data['error']);
      }
    });
    
    // Send check request
    socket.emit('force_sensor_check', deviceId);
    
    return completer.future;
  }
  
  // Usage example
  void performSensorCheck() async {
    try {
      await forceSensorCheck('esp32_controller_001');
      print('Sensor check completed successfully');
    } catch (e) {
      print('Sensor check failed: $e');
    }
  }
}
```

### 5. Handle Real-time Events

```dart
class SensorMonitoringService {
  void _handleSensorStatusUpdate(Map<String, dynamic> data) {
    final deviceId = data['device_id'];
    final groundSensor = data['ground_sensor'];
    final roofSensor = data['roof_sensor'];
    final pumpStatus = data['pump_status'];
    
    // Update UI with real-time sensor status
    _updateSensorStatusUI(deviceId, groundSensor, roofSensor, pumpStatus);
    
    // Check for critical issues
    if (!groundSensor['connected'] || !roofSensor['connected']) {
      _showSensorOfflineAlert(deviceId, groundSensor, roofSensor);
    }
  }
  
  void _handlePumpPaused(Map<String, dynamic> data) {
    final deviceId = data['device_id'];
    final reason = data['reason'];
    final sensorStatus = data['sensor_status'];
    
    // Show pump paused notification
    _showPumpPausedNotification(deviceId, reason, sensorStatus);
    
    // Update pump status in UI
    _updatePumpStatus(deviceId, false, 'Paused due to sensor issues');
  }
  
  void _handlePumpResumed(Map<String, dynamic> data) {
    final deviceId = data['device_id'];
    final reason = data['reason'];
    
    // Show pump resumed notification
    _showPumpResumedNotification(deviceId, reason);
    
    // Update pump status in UI
    _updatePumpStatus(deviceId, true, 'Running normally');
  }
  
  void _handleOverrideUpdate(Map<String, dynamic> data) {
    final deviceId = data['device_id'];
    final overrideEnabled = data['override_enabled'];
    final reason = data['reason'];
    
    // Update override status in UI
    _updateOverrideStatus(deviceId, overrideEnabled, reason);
    
    // Show override notification
    if (overrideEnabled) {
      _showOverrideEnabledNotification(deviceId, reason);
    } else {
      _showOverrideDisabledNotification(deviceId);
    }
  }
  
  void _handleSystemAlert(Map<String, dynamic> data) {
    final alertType = data['type'];
    final severity = data['severity'];
    final message = data['message'];
    final deviceId = data['device_id'];
    
    // Show system alert based on severity
    _showSystemAlert(alertType, severity, message, deviceId);
  }
}
```

## Frontend Implementation (React/JavaScript)

### 1. WebSocket Connection Setup

```javascript
import { io } from 'socket.io-client';

class SensorMonitoringService {
  constructor() {
    this.socket = io('ws://your-backend-url:3002', {
      transports: ['websocket']
    });
    
    this.setupEventListeners();
  }
  
  connect(deviceId) {
    this.socket.emit('subscribe_device', deviceId);
  }
  
  setupEventListeners() {
    // Real-time sensor status updates
    this.socket.on('sensor_monitoring_update', (data) => {
      this.handleSensorStatusUpdate(data);
    });
    
    // Pump control events
    this.socket.on('pump_paused_sensor', (data) => {
      this.handlePumpPaused(data);
    });
    
    this.socket.on('pump_resumed_sensor', (data) => {
      this.handlePumpResumed(data);
    });
    
    // Override updates
    this.socket.on('sensor_override_update', (data) => {
      this.handleOverrideUpdate(data);
    });
    
    // System alerts
    this.socket.on('system_alert', (data) => {
      this.handleSystemAlert(data);
    });
  }
}
```

### 2. React Hook for Sensor Monitoring

```javascript
import { useState, useEffect } from 'react';
import { useSocket } from './useSocket';

export const useSensorMonitoring = (deviceId) => {
  const [sensorStatus, setSensorStatus] = useState(null);
  const [pumpStatus, setPumpStatus] = useState(null);
  const [overrideStatus, setOverrideStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const socket = useSocket();
  
  useEffect(() => {
    if (socket && deviceId) {
      // Subscribe to device
      socket.emit('subscribe_device', deviceId);
      
      // Get initial status
      getSensorStatus();
    }
  }, [socket, deviceId]);
  
  const getSensorStatus = () => {
    setLoading(true);
    setError(null);
    
    socket.emit('get_sensor_status', deviceId);
    
    socket.once('sensor_status_response', (data) => {
      setLoading(false);
      if (data.success) {
        setSensorStatus(data.data);
      } else {
        setError(data.error);
      }
    });
  };
  
  const overrideSensorMonitoring = async (enable, reason) => {
    setLoading(true);
    setError(null);
    
    return new Promise((resolve, reject) => {
      socket.emit('override_sensor_monitoring', {
        device_id: deviceId,
        enable,
        reason
      });
      
      socket.once('sensor_override_response', (data) => {
        setLoading(false);
        if (data.success) {
          resolve(data.data);
        } else {
          setError(data.error);
          reject(data.error);
        }
      });
    });
  };
  
  const forceSensorCheck = async () => {
    setLoading(true);
    setError(null);
    
    return new Promise((resolve, reject) => {
      socket.emit('force_sensor_check', deviceId);
      
      socket.once('sensor_check_response', (data) => {
        setLoading(false);
        if (data.success) {
          resolve(data.data);
        } else {
          setError(data.error);
          reject(data.error);
        }
      });
    });
  };
  
  // Listen for real-time updates
  useEffect(() => {
    if (!socket) return;
    
    const handleSensorUpdate = (data) => {
      if (data.device_id === deviceId) {
        setSensorStatus(prev => ({
          ...prev,
          ...data
        }));
      }
    };
    
    const handlePumpUpdate = (data) => {
      if (data.device_id === deviceId) {
        setPumpStatus(data);
      }
    };
    
    const handleOverrideUpdate = (data) => {
      if (data.device_id === deviceId) {
        setOverrideStatus(data);
      }
    };
    
    socket.on('sensor_monitoring_update', handleSensorUpdate);
    socket.on('pump_paused_sensor', handlePumpUpdate);
    socket.on('pump_resumed_sensor', handlePumpUpdate);
    socket.on('sensor_override_update', handleOverrideUpdate);
    
    return () => {
      socket.off('sensor_monitoring_update', handleSensorUpdate);
      socket.off('pump_paused_sensor', handlePumpUpdate);
      socket.off('pump_resumed_sensor', handlePumpUpdate);
      socket.off('sensor_override_update', handleOverrideUpdate);
    };
  }, [socket, deviceId]);
  
  return {
    sensorStatus,
    pumpStatus,
    overrideStatus,
    loading,
    error,
    getSensorStatus,
    overrideSensorMonitoring,
    forceSensorCheck
  };
};
```

### 3. React Component Example

```jsx
import React from 'react';
import { useSensorMonitoring } from './useSensorMonitoring';

export const SensorMonitoringWidget = ({ deviceId }) => {
  const {
    sensorStatus,
    pumpStatus,
    overrideStatus,
    loading,
    error,
    overrideSensorMonitoring,
    forceSensorCheck
  } = useSensorMonitoring(deviceId);
  
  const handleOverrideToggle = async () => {
    try {
      if (overrideStatus?.override_enabled) {
        await overrideSensorMonitoring(false, 'Override disabled by user');
      } else {
        await overrideSensorMonitoring(true, 'Override enabled by user');
      }
    } catch (err) {
      console.error('Failed to toggle override:', err);
    }
  };
  
  if (loading) return <div>Loading sensor status...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <div className="sensor-monitoring-widget">
      <h3>Sensor Monitoring Status</h3>
      
      {/* Sensor Status */}
      <div className="sensor-status">
        <h4>Sensors</h4>
        <div className="sensor-grid">
          <div className={`sensor ${sensorStatus?.ground_sensor?.connected ? 'connected' : 'disconnected'}`}>
            <span>Ground Tank</span>
            <span>{sensorStatus?.ground_sensor?.connected ? 'Connected' : 'Disconnected'}</span>
            <span>{sensorStatus?.ground_sensor?.working ? 'Working' : 'Not Working'}</span>
          </div>
          <div className={`sensor ${sensorStatus?.roof_sensor?.connected ? 'connected' : 'disconnected'}`}>
            <span>Roof Tank</span>
            <span>{sensorStatus?.roof_sensor?.connected ? 'Connected' : 'Disconnected'}</span>
            <span>{sensorStatus?.roof_sensor?.working ? 'Working' : 'Not Working'}</span>
          </div>
        </div>
      </div>
      
      {/* Pump Status */}
      <div className="pump-status">
        <h4>Pump Status</h4>
        <div className={`pump ${pumpStatus?.running ? 'running' : 'stopped'}`}>
          <span>Status: {pumpStatus?.running ? 'Running' : 'Stopped'}</span>
          {pumpStatus?.paused_by_sensor && (
            <span className="paused-warning">Paused due to sensor issues</span>
          )}
        </div>
      </div>
      
      {/* Override Status */}
      <div className="override-status">
        <h4>Override Status</h4>
        <div className={`override ${overrideStatus?.override_enabled ? 'enabled' : 'disabled'}`}>
          <span>Monitoring: {overrideStatus?.override_enabled ? 'Overridden' : 'Active'}</span>
          {overrideStatus?.override_enabled && (
            <span>Reason: {overrideStatus?.reason}</span>
          )}
        </div>
      </div>
      
      {/* Controls */}
      <div className="controls">
        <button onClick={handleOverrideToggle}>
          {overrideStatus?.override_enabled ? 'Disable Override' : 'Enable Override'}
        </button>
        <button onClick={forceSensorCheck}>
          Force Sensor Check
        </button>
      </div>
    </div>
  );
};
```

## Error Handling and Best Practices

### 1. Connection Management

```javascript
class SensorMonitoringService {
  constructor() {
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    
    this.setupConnectionHandling();
  }
  
  setupConnectionHandling() {
    this.socket.on('connect', () => {
      console.log('Connected to WebSocket');
      this.reconnectAttempts = 0;
      
      // Resubscribe to device after reconnection
      if (this.currentDeviceId) {
        this.socket.emit('subscribe_device', this.currentDeviceId);
      }
    });
    
    this.socket.on('disconnect', () => {
      console.log('Disconnected from WebSocket');
      this.handleReconnection();
    });
    
    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.handleReconnection();
    });
  }
  
  handleReconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      
      setTimeout(() => {
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.socket.connect();
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
      // Notify user or fallback to polling
    }
  }
}
```

### 2. Event Timeout Handling

```javascript
class SensorMonitoringService {
  async requestWithTimeout(eventName, data, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Request timeout for ${eventName}`));
      }, timeoutMs);
      
      // Listen for response
      this.socket.once(eventName, (response) => {
        clearTimeout(timeoutId);
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error));
        }
      });
      
      // Send request
      this.socket.emit(eventName, data);
    });
  }
  
  // Usage
  async getSensorStatus(deviceId) {
    try {
      return await this.requestWithTimeout('get_sensor_status', deviceId);
    } catch (error) {
      console.error('Failed to get sensor status:', error);
      throw error;
    }
  }
}
```

### 3. State Synchronization

```javascript
class SensorMonitoringService {
  constructor() {
    this.state = {
      sensorStatus: null,
      pumpStatus: null,
      overrideStatus: null,
      lastUpdate: null
    };
    
    this.listeners = new Set();
  }
  
  addStateListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  updateState(newState) {
    this.state = { ...this.state, ...newState, lastUpdate: Date.now() };
    this.notifyListeners();
  }
  
  notifyListeners() {
    this.listeners.forEach(listener => listener(this.state));
  }
  
  // Sync state with backend
  async syncState(deviceId) {
    try {
      const [sensorStatus, overrideStatus] = await Promise.all([
        this.getSensorStatus(deviceId),
        this.getOverrideStatus(deviceId)
      ]);
      
      this.updateState({ sensorStatus, overrideStatus });
    } catch (error) {
      console.error('Failed to sync state:', error);
    }
  }
}
```

This implementation provides a robust, real-time sensor monitoring system that integrates seamlessly with your existing WebSocket-based architecture.
