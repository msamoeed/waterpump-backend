# Mobile App Pump Pause UI Implementation

## Overview
This guide shows how to implement a comprehensive UI in your mobile app to display when the pump is paused due to sensor failure, including detailed error information, estimated recovery time, and required actions.

## Flutter Implementation

### 1. Pump Pause Status Widget

```dart
import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

class PumpPauseStatusWidget extends StatefulWidget {
  final String deviceId;
  
  const PumpPauseStatusWidget({Key? key, required this.deviceId}) : super(key: key);
  
  @override
  _PumpPauseStatusWidgetState createState() => _PumpPauseStatusWidgetState();
}

class _PumpPauseStatusWidgetState extends State<PumpPauseStatusWidget> {
  Map<String, dynamic>? pumpPauseDetails;
  bool isLoading = false;
  String? errorMessage;
  
  @override
  void initState() {
    super.initState();
    _listenToPumpPauseEvents();
  }
  
  void _listenToPumpPauseEvents() {
    // Listen for detailed pump pause events
    socket.on('pump_pause_details', (data) {
      if (data['device_id'] == widget.deviceId) {
        setState(() {
          pumpPauseDetails = data;
          isLoading = false;
        });
      }
    });
    
    // Listen for pump resume events
    socket.on('pump_resumed_sensor', (data) {
      if (data['device_id'] == widget.deviceId) {
        setState(() {
          pumpPauseDetails = null;
        });
        _showPumpResumedSnackBar();
      }
    });
  }
  
  @override
  Widget build(BuildContext context) {
    if (pumpPauseDetails == null) {
      return const SizedBox.shrink(); // Don't show if pump is not paused
    }
    
    return Card(
      margin: const EdgeInsets.all(16),
      color: _getPauseCardColor(),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildPauseHeader(),
            const SizedBox(height: 16),
            _buildSensorStatusSection(),
            const SizedBox(height: 16),
            _buildPumpStateSection(),
            const SizedBox(height: 16),
            _buildRecoveryInfoSection(),
            const SizedBox(height: 16),
            _buildActionButtons(),
          ],
        ),
      ),
    );
  }
  
  Widget _buildPauseHeader() {
    final severity = pumpPauseDetails!['severity'] ?? 'high';
    final requiresManual = pumpPauseDetails!['pause_details']['requires_manual_intervention'] ?? false;
    
    return Row(
      children: [
        Icon(
          requiresManual ? Icons.warning_amber : Icons.info_outline,
          color: requiresManual ? Colors.orange : Colors.blue,
          size: 28,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Pump Paused',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              Text(
                requiresManual ? 'Manual Intervention Required' : 'Automatic Recovery Expected',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Colors.white70,
                ),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: _getSeverityColor(severity),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            severity.toUpperCase(),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildSensorStatusSection() {
    final groundSensor = pumpPauseDetails!['pause_details']['ground_sensor'];
    final roofSensor = pumpPauseDetails!['pause_details']['roof_sensor'];
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Sensor Status',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _buildSensorCard(
                'Ground Tank',
                groundSensor['connected'],
                groundSensor['working'],
                groundSensor['error_type'],
                groundSensor['last_reading'],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _buildSensorCard(
                'Roof Tank',
                roofSensor['connected'],
                roofSensor['working'],
                roofSensor['error_type'],
                roofSensor['last_reading'],
              ),
            ),
          ],
        ),
      ],
    );
  }
  
  Widget _buildSensorCard(String title, bool connected, bool working, String errorType, dynamic lastReading) {
    final isError = !connected || !working;
    final backgroundColor = isError ? Colors.red.shade700 : Colors.green.shade700;
    
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Icon(
                connected ? Icons.wifi : Icons.wifi_off,
                color: Colors.white,
                size: 16,
              ),
              const SizedBox(width: 4),
              Text(
                connected ? 'Connected' : 'Disconnected',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Icon(
                working ? Icons.check_circle : Icons.error,
                color: Colors.white,
                size: 16,
              ),
              const SizedBox(width: 4),
              Text(
                working ? 'Working' : 'Not Working',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          if (lastReading != null) ...[
            const SizedBox(height: 4),
            Text(
              'Last: ${lastReading.toStringAsFixed(1)}%',
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11,
              ),
            ),
          ],
          if (errorType != 'none') ...[
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.white24,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                _getErrorTypeLabel(errorType),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
  
  Widget _buildPumpStateSection() {
    final pumpState = pumpPauseDetails!['pause_details']['pump_state_before_pause'];
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Pump State Before Pause',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white24,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Icon(
                pumpState['running'] ? Icons.play_circle : Icons.stop_circle,
                color: Colors.white,
                size: 24,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Status: ${pumpState['running'] ? 'Running' : 'Stopped'}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    Text(
                      'Mode: ${pumpState['mode']}',
                      style: const TextStyle(color: Colors.white70),
                    ),
                    if (pumpState['target_level'] != null)
                      Text(
                        'Target: ${pumpState['target_level']}%',
                        style: const TextStyle(color: Colors.white70),
                      ),
                    Text(
                      'Runtime: ${pumpState['runtime_minutes']} min',
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
  
  Widget _buildRecoveryInfoSection() {
    final estimatedResumeTime = pumpPauseDetails!['pause_details']['estimated_resume_time'];
    final requiresManual = pumpPauseDetails!['pause_details']['requires_manual_intervention'];
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Recovery Information',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: requiresManual ? Colors.orange.shade700 : Colors.blue.shade700,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    requiresManual ? Icons.tools : Icons.auto_fix_high,
                    color: Colors.white,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    requiresManual ? 'Manual Intervention Required' : 'Automatic Recovery',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              if (estimatedResumeTime != null) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Icon(
                      Icons.schedule,
                      color: Colors.white70,
                      size: 16,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Estimated Resume: ${_formatEstimatedTime(estimatedResumeTime)}',
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              Text(
                requiresManual 
                  ? 'Both sensors are disconnected. Manual inspection and repair required.'
                  : 'Sensors are experiencing temporary issues. Automatic recovery expected.',
                style: const TextStyle(color: Colors.white70),
              ),
            ],
          ),
        ),
      ],
    );
  }
  
  Widget _buildActionButtons() {
    final requiresManual = pumpPauseDetails!['pause_details']['requires_manual_intervention'] ?? false;
    
    return Row(
      children: [
        Expanded(
          child: ElevatedButton.icon(
            onPressed: _forceSensorCheck,
            icon: const Icon(Icons.refresh),
            label: const Text('Force Sensor Check'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.blue,
              foregroundColor: Colors.white,
            ),
          ),
        ),
        const SizedBox(width: 12),
        if (requiresManual)
          Expanded(
            child: ElevatedButton.icon(
              onPressed: _enableOverride,
              icon: const Icon(Icons.warning),
              label: const Text('Enable Override'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.orange,
                foregroundColor: Colors.white,
              ),
            ),
          ),
      ],
    );
  }
  
  // Helper methods
  Color _getPauseCardColor() {
    final requiresManual = pumpPauseDetails!['pause_details']['requires_manual_intervention'] ?? false;
    return requiresManual ? Colors.red.shade800 : Colors.orange.shade800;
  }
  
  Color _getSeverityColor(String severity) {
    switch (severity) {
      case 'critical':
        return Colors.red;
      case 'high':
        return Colors.orange;
      case 'warning':
        return Colors.yellow.shade700;
      default:
        return Colors.grey;
    }
  }
  
  String _getErrorTypeLabel(String errorType) {
    switch (errorType) {
      case 'disconnected':
        return 'Disconnected';
      case 'no_data':
        return 'No Data';
      case 'invalid_reading':
        return 'Invalid Reading';
      case 'timeout':
        return 'Timeout';
      default:
        return 'Unknown';
    }
  }
  
  String _formatEstimatedTime(String isoString) {
    try {
      final estimatedTime = DateTime.parse(isoString);
      final now = DateTime.now();
      final difference = estimatedTime.difference(now);
      
      if (difference.inMinutes < 1) {
        return 'Less than 1 minute';
      } else if (difference.inMinutes < 60) {
        return '${difference.inMinutes} minutes';
      } else {
        final hours = difference.inHours;
        final minutes = difference.inMinutes % 60;
        return '${hours}h ${minutes}m';
      }
    } catch (e) {
      return 'Unknown';
    }
  }
  
  // Action methods
  void _forceSensorCheck() {
    socket.emit('force_sensor_check', widget.deviceId);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Sensor check initiated...')),
    );
  }
  
  void _enableOverride() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Enable Sensor Override'),
        content: const Text(
          'This will disable automatic sensor monitoring and allow the pump to run '
          'even with sensor issues. Use only for maintenance or emergency situations.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(context).pop();
              _confirmOverride();
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
            child: const Text('Enable Override'),
          ),
        ],
      ),
    );
  }
  
  void _confirmOverride() {
    socket.emit('override_sensor_monitoring', {
      'device_id': widget.deviceId,
      'enable': true,
      'reason': 'Manual override due to sensor failure',
    });
    
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Override enabled. Pump can now run despite sensor issues.'),
        backgroundColor: Colors.orange,
      ),
    );
  }
  
  void _showPumpResumedSnackBar() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Pump resumed! Sensors are working again.'),
        backgroundColor: Colors.green,
      ),
    );
  }
}
```

### 2. Integration with Main Dashboard

```dart
class WaterPumpDashboard extends StatefulWidget {
  @override
  _WaterPumpDashboardState createState() => _WaterPumpDashboardState();
}

class _WaterPumpDashboardState extends State<WaterPumpDashboard> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Water Pump Dashboard'),
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            // Pump pause status widget (shows only when pump is paused)
            PumpPauseStatusWidget(deviceId: 'esp32_controller_001'),
            
            // Other dashboard widgets...
            TankLevelWidget(),
            PumpStatusWidget(),
            SensorStatusWidget(),
          ],
        ),
      ),
    );
  }
}
```

### 3. Sensor Status Widget

```dart
class SensorStatusWidget extends StatefulWidget {
  @override
  _SensorStatusWidgetState createState() => _SensorStatusWidgetState();
}

class _SensorStatusWidgetState extends State<SensorStatusWidget> {
  Map<String, dynamic>? sensorStatus;
  
  @override
  void initState() {
    super.initState();
    _listenToSensorUpdates();
  }
  
  void _listenToSensorUpdates() {
    socket.on('sensor_monitoring_update', (data) {
      setState(() {
        sensorStatus = data;
      });
    });
  }
  
  @override
  Widget build(BuildContext context) {
    if (sensorStatus == null) {
      return const CircularProgressIndicator();
    }
    
    return Card(
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Sensor Status',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: _buildSensorIndicator(
                    'Ground Tank',
                    sensorStatus!['ground_sensor']['connected'],
                    sensorStatus!['ground_sensor']['working'],
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: _buildSensorIndicator(
                    'Roof Tank',
                    sensorStatus!['roof_sensor']['connected'],
                    sensorStatus!['roof_sensor']['working'],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            _buildPumpStatusIndicator(),
          ],
        ),
      ),
    );
  }
  
  Widget _buildSensorIndicator(String title, bool connected, bool working) {
    final status = connected && working ? 'OK' : 'ISSUE';
    final color = connected && working ? Colors.green : Colors.red;
    final icon = connected && working ? Icons.check_circle : Icons.error;
    
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 32),
          const SizedBox(height: 8),
          Text(
            title,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          Text(
            status,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildPumpStatusIndicator() {
    final pumpRunning = sensorStatus!['pump_status']['running'];
    final pausedBySensor = sensorStatus!['pump_status']['paused_by_sensor'];
    
    Color statusColor;
    String statusText;
    IconData statusIcon;
    
    if (pausedBySensor) {
      statusColor = Colors.orange;
      statusText = 'PAUSED (Sensor Issue)';
      statusIcon = Icons.pause_circle;
    } else if (pumpRunning) {
      statusColor = Colors.green;
      statusText = 'RUNNING';
      statusIcon = Icons.play_circle;
    } else {
      statusColor = Colors.grey;
      statusText = 'STOPPED';
      statusIcon = Icons.stop_circle;
    }
    
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: statusColor.withOpacity(0.1),
        border: Border.all(color: statusColor),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(statusIcon, color: statusColor, size: 32),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Pump Status',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                Text(
                  statusText,
                  style: TextStyle(
                    color: statusColor,
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
```

## Key Features

### 1. **Visual Status Indicators**
- Color-coded cards based on severity (red for critical, orange for high, blue for info)
- Icons showing sensor connection and working status
- Clear pump state indicators

### 2. **Detailed Error Information**
- Specific error types (disconnected, no data, invalid reading, timeout)
- Last known sensor readings
- Timestamps for when issues occurred

### 3. **Recovery Information**
- Estimated resume time based on error types
- Clear indication if manual intervention is required
- Automatic vs. manual recovery expectations

### 4. **Action Buttons**
- Force sensor check to trigger immediate status update
- Enable override for emergency situations
- Clear feedback for all actions

### 5. **Real-time Updates**
- WebSocket events for immediate status changes
- Automatic UI updates when pump resumes
- Push notifications for critical issues

## Usage in Mobile App

1. **Dashboard Integration**: Add the `PumpPauseStatusWidget` to your main dashboard
2. **Real-time Monitoring**: Listen to WebSocket events for immediate updates
3. **User Actions**: Provide clear buttons for sensor checks and overrides
4. **Notifications**: Show appropriate alerts based on severity levels
5. **Status History**: Track and display sensor issue patterns over time

This implementation provides a comprehensive and user-friendly way to monitor pump status and handle sensor failures in your mobile app! 🚀
