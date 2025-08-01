import { Injectable, Inject } from '@nestjs/common';
import { InfluxService } from '../../database/services/influx.service';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';
import { WebSocketGateway } from '../websocket/websocket.gateway';
import { DeviceStatusUpdateDto, PumpCommandDto } from '../../common/dto/device-status-update.dto';
import { DeviceUpdateEvent, PumpEvent, AlertEvent } from '../../common/interfaces/websocket-events.interface';

@Injectable()
export class DevicesService {
  constructor(
    @Inject('INFLUXDB_SERVICE') public influxService: InfluxService,
    @Inject('REDIS_SERVICE') private redisService: RedisService,
    @Inject('POSTGRES_SERVICE') private postgresService: PostgresService,
    private websocketGateway: WebSocketGateway,
  ) {}

  async updateDeviceStatus(statusUpdate: DeviceStatusUpdateDto): Promise<void> {
    const timestamp = new Date();

    // Check if device exists in PostgreSQL, create if it doesn't
    let device = await this.postgresService.getDevice(statusUpdate.device_id);
    if (!device) {
      console.log(`Creating new device: ${statusUpdate.device_id}`);
      try {
        device = await this.postgresService.createDevice({
          device_id: statusUpdate.device_id,
          name: `ESP32 Controller - ${statusUpdate.device_id}`,
          location: 'Water Pump System',
          tank_capacity_liters: 1000, // Default value
          pump_max_current: 10.0, // Default value
        });
        console.log(`Device created successfully: ${device.device_id}`);
      } catch (error) {
        console.error(`Failed to create device ${statusUpdate.device_id}:`, error);
        // Continue without device creation to avoid blocking the status update
      }
    } else {
      console.log(`Device already exists: ${statusUpdate.device_id}`);
    }

    // Store in InfluxDB (parallel execution)
    const influxPromises = [
      this.influxService.writeWaterLevels(statusUpdate, timestamp),
      this.influxService.writePumpMetrics(statusUpdate, timestamp),
    ];

    // Store in Redis for real-time access
    const redisPromise = this.redisService.setDeviceStatus(
      statusUpdate.device_id,
      statusUpdate,
      300, // 5 minutes TTL
    );

    // Execute all database operations in parallel
    await Promise.all([...influxPromises, redisPromise]);

    // Emit real-time update via WebSocket
    this.websocketGateway.emitDeviceUpdate(statusUpdate.device_id, {
      device_id: statusUpdate.device_id,
      status: statusUpdate,
      timestamp: timestamp.toISOString(),
    });

    // Check for alerts
    await this.checkAndProcessAlerts(statusUpdate);
  }

  async handlePumpEvent(pumpEvent: any): Promise<void> {
    const timestamp = new Date();
    
    // Extract device_id from the event or use a default
    const deviceId = pumpEvent.device_id || 'esp32_controller_001';

    // Store pump event in InfluxDB
    await this.influxService.writeSystemEvent(
      deviceId,
      'pump_event',
      pumpEvent.trigger_reason || 'Unknown reason',
      'info',
      timestamp
    );

    // Emit pump event via WebSocket
    this.websocketGateway.emitPumpEvent({
      event_type: pumpEvent.event_type,
      pump_on: pumpEvent.pump_on,
      trigger_reason: pumpEvent.trigger_reason,
      ground_tank_level: pumpEvent.ground_tank_level,
      roof_tank_level: pumpEvent.roof_tank_level,
      pump_current: pumpEvent.pump_current,
      pump_power: pumpEvent.pump_power,
      protection_active: pumpEvent.protection_active,
      timestamp: timestamp.toISOString(),
    });

    // Log event in PostgreSQL
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'pump_event',
      message: `${pumpEvent.event_type}: ${pumpEvent.trigger_reason}`,
      severity: 'info',
    });
  }

  async handlePumpCommand(pumpCommand: PumpCommandDto): Promise<void> {
    const timestamp = new Date();
    const deviceId = pumpCommand.device_id || 'esp32_controller_001';
    
    // Validate command
    if (!pumpCommand.action) {
      throw new Error('Pump action is required');
    }
    
    // Store command in Redis for ESP32 to pick up
    const commandKey = `pump_command:${deviceId}`;
    const commandData = {
      action: pumpCommand.action,
      target_level: pumpCommand.target_level || null,
      reason: pumpCommand.reason || 'API command',
      timestamp: timestamp.toISOString(),
      processed: false
    };
    
    await this.redisService.set(commandKey, JSON.stringify(commandData), 60); // 1 minute TTL
    
    // Log command in PostgreSQL
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'pump_command',
      message: `API Command: ${pumpCommand.action} - ${pumpCommand.reason || 'No reason provided'}`,
      severity: 'info',
    });
    
    // Emit command via WebSocket
    this.websocketGateway.emitPumpEvent({
      event_type: 'pump_command',
      pump_on: pumpCommand.action === 'start' || pumpCommand.action === 'target',
      trigger_reason: `API Command: ${pumpCommand.action}`,
      ground_tank_level: 0, // Will be updated by ESP32
      roof_tank_level: 0,   // Will be updated by ESP32
      pump_current: 0,      // Will be updated by ESP32
      pump_power: 0,        // Will be updated by ESP32
      protection_active: false,
      timestamp: timestamp.toISOString(),
    });
  }

  async getPumpCommand(deviceId: string): Promise<any> {
    const commandKey = `pump_command:${deviceId}`;
    const commandData = await this.redisService.get(commandKey);
    
    if (commandData) {
      // Clear the command after retrieving it
      await this.redisService.del(commandKey);
      return JSON.parse(commandData);
    }
    
    return null;
  }

  async getCurrentStatus(deviceId: string): Promise<any> {
    // Try to get from Redis cache first
    const cachedStatus = await this.redisService.getDeviceStatus(deviceId);
    
    if (cachedStatus) {
      return JSON.parse(cachedStatus);
    }

    // Fallback to InfluxDB for recent data
    const influxData = await this.influxService.getLatestDeviceData(deviceId);
    
    if (influxData && influxData.length > 0) {
      return this.formatInfluxData(deviceId, influxData);
    }

    return null;
  }

  async getAllDevicesStatus(): Promise<Record<string, any>> {
    const keys = await this.redisService.getDeviceKeys();
    const devices: Record<string, any> = {};

    for (const key of keys) {
      const deviceId = key.split(':')[1];
      const statusData = await this.redisService.get(key);
      if (statusData) {
        devices[deviceId] = JSON.parse(statusData);
      }
    }

    return devices;
  }

  async getDeviceHistory(
    deviceId: string, 
    measurement: string, 
    startTime: string, 
    endTime: string,
    aggregateWindow?: string
  ): Promise<any[]> {
    return await this.influxService.queryHistoricalData(
      deviceId,
      measurement,
      startTime,
      endTime,
      aggregateWindow
    );
  }

  async getSystemStats(): Promise<any> {
    const [postgresStats, redisStats] = await Promise.all([
      this.postgresService.getSystemStats(),
      this.getRedisStats(),
    ]);

    return {
      ...postgresStats,
      redis: redisStats,
      websocket: {
        connectedClients: this.websocketGateway.getConnectedClientsCount(),
        subscribedDevices: this.websocketGateway.getSubscribedDevices(),
      },
    };
  }

  async getTimeSeriesData(
    deviceId: string,
    startTime: string,
    endTime: string,
    aggregateWindow: string
  ): Promise<any[]> {
    try {
      // Get water levels data
      const waterLevelsData = await this.influxService.queryHistoricalData(
        deviceId,
        'water_levels',
        startTime,
        endTime,
        aggregateWindow
      );

      // Get pump metrics data
      const pumpMetricsData = await this.influxService.queryHistoricalData(
        deviceId,
        'pump_metrics',
        startTime,
        endTime,
        aggregateWindow
      );

      // Process and format the data for the frontend
      const processedData = this.processTimeSeriesData(waterLevelsData, pumpMetricsData);
      
      return processedData;
    } catch (error) {
      console.error('Error getting time series data:', error);
      throw error;
    }
  }

  private async checkAndProcessAlerts(statusUpdate: DeviceStatusUpdateDto): Promise<void> {
    try {
      // Ensure device exists before processing alerts
      let device = await this.postgresService.getDevice(statusUpdate.device_id);
      if (!device) {
        console.log(`Device ${statusUpdate.device_id} not found, skipping alerts`);
        return;
      }

      const alerts = [];

      // Check sensor connectivity
      if (!statusUpdate.ground_tank.connected) {
        alerts.push({
          type: 'sensor_offline',
          message: 'Ground tank sensor offline',
          severity: 'high',
        });
      }

      if (!statusUpdate.roof_tank.connected) {
        alerts.push({
          type: 'sensor_offline',
          message: 'Roof tank sensor offline',
          severity: 'high',
        });
      }

      // Check water levels
      if (statusUpdate.ground_tank.level_percent < 15) {
        alerts.push({
          type: 'low_water',
          message: 'Ground tank critically low',
          severity: 'critical',
        });
      }

      if (statusUpdate.roof_tank.level_percent < 20) {
        alerts.push({
          type: 'low_water',
          message: 'Roof tank low water level',
          severity: 'warning',
        });
      }

      // Check pump protection
      if (statusUpdate.pump.protection_active) {
        alerts.push({
          type: 'pump_protection',
          message: 'Pump protection activated',
          severity: 'critical',
        });
      }

      // Check pump current
      if (statusUpdate.pump.current_amps > 10) {
        alerts.push({
          type: 'overcurrent',
          message: 'Pump overcurrent detected',
          severity: 'critical',
        });
      }

      // Process alerts if any
      if (alerts.length > 0) {
        await this.processAlerts(statusUpdate.device_id, alerts);
      }
    } catch (error) {
      console.error('Error processing alerts:', error);
    }
  }

  private async processAlerts(deviceId: string, alerts: any[]): Promise<void> {
    try {
      // Verify device exists before processing alerts
      const device = await this.postgresService.getDevice(deviceId);
      if (!device) {
        console.log(`Device ${deviceId} not found, skipping alert processing`);
        return;
      }

      // Store alerts in PostgreSQL
      for (const alert of alerts) {
        try {
          await this.postgresService.insertAlert(deviceId, alert);
        } catch (error) {
          console.error(`Failed to insert alert for device ${deviceId}:`, error);
        }
      }

      // Store active alerts in Redis
      for (const alert of alerts) {
        try {
          const alertId = `${alert.type}_${Date.now()}`;
          await this.redisService.setActiveAlert(deviceId, alertId, alert);
        } catch (error) {
          console.error(`Failed to store alert in Redis for device ${deviceId}:`, error);
        }
      }

      // Emit to WebSocket clients
      for (const alert of alerts) {
        try {
          this.websocketGateway.emitAlert({
            device_id: deviceId,
            alert_type: alert.type,
            message: alert.message,
            severity: alert.severity,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error(`Failed to emit alert via WebSocket for device ${deviceId}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in processAlerts:', error);
    }
  }

  private formatInfluxData(deviceId: string, influxData: any[]): any {
    // Convert InfluxDB data format to our standard format
    const formatted = {
      device_id: deviceId,
      timestamp: Date.now(),
      ground_tank: {
        level_percent: 0,
        level_inches: 0,
        alarm_active: false,
        connected: false,
        sensor_working: false,
        water_supply_on: false,
      },
      roof_tank: {
        level_percent: 0,
        level_inches: 0,
        alarm_active: false,
        connected: false,
        sensor_working: false,
        water_supply_on: false,
      },
      pump: {
        running: false,
        manual_override: false,
        current_amps: 0,
        power_watts: 0,
        daily_consumption: 0,
        hourly_consumption: 0,
        runtime_minutes: 0,
        total_runtime_hours: 0,
        protection_active: false,
        overcurrent_protection: false,
        overtime_protection: false,
      },
      system: {
        auto_mode_enabled: true,
        manual_pump_control: false,
        water_supply_active: false,
      },
    };

    // Process InfluxDB data points
    for (const point of influxData) {
      if (point._measurement === 'water_levels') {
        const tank = point.tank_id === 'ground' ? 'ground_tank' : 'roof_tank';
        if (point._field === 'level_percent') formatted[tank].level_percent = point._value;
        if (point._field === 'level_inches') formatted[tank].level_inches = point._value;
        if (point._field === 'connected') formatted[tank].connected = point._value;
        if (point._field === 'sensor_working') formatted[tank].sensor_working = point._value;
      } else if (point._measurement === 'pump_metrics') {
        if (point._field === 'current_amps') formatted.pump.current_amps = point._value;
        if (point._field === 'power_watts') formatted.pump.power_watts = point._value;
        if (point._field === 'running') formatted.pump.running = point._value;
        if (point._field === 'protection_active') formatted.pump.protection_active = point._value;
      }
    }

    return formatted;
  }

  private async getRedisStats(): Promise<any> {
    try {
      const ping = await this.redisService.ping();
      return {
        status: ping === 'PONG' ? 'connected' : 'disconnected',
        ping: ping,
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  private processTimeSeriesData(waterLevelsData: any[], pumpMetricsData: any[]): any[] {
    // Create a map to store data by timestamp
    const timeMap = new Map<string, any>();

    // Process water levels data (raw InfluxDB format)
    waterLevelsData.forEach(record => {
      const timestamp = record._time;
      if (!timeMap.has(timestamp)) {
        timeMap.set(timestamp, {
          time: timestamp,
          groundLevel: 0,
          roofLevel: 0,
          pumpStatus: 0,
          pumpPower: 0,
          pumpCurrent: 0,
        });
      }

      const dataPoint = timeMap.get(timestamp);
      
      // Handle different field types from InfluxDB
      if (record._field === 'level_percent') {
        if (record.tank_id === 'ground') {
          dataPoint.groundLevel = record._value || 0;
        } else if (record.tank_id === 'roof') {
          dataPoint.roofLevel = record._value || 0;
        }
      }
    });

    // Process pump metrics data (raw InfluxDB format)
    pumpMetricsData.forEach(record => {
      const timestamp = record._time;
      if (!timeMap.has(timestamp)) {
        timeMap.set(timestamp, {
          time: timestamp,
          groundLevel: 0,
          roofLevel: 0,
          pumpStatus: 0,
          pumpPower: 0,
          pumpCurrent: 0,
        });
      }

      const dataPoint = timeMap.get(timestamp);
      
      // Handle different field types from InfluxDB
      if (record._field === 'running') {
        dataPoint.pumpStatus = record._value ? 1 : 0;
      } else if (record._field === 'power_watts') {
        dataPoint.pumpPower = record._value || 0;
      } else if (record._field === 'current_amps') {
        dataPoint.pumpCurrent = record._value || 0;
      }
    });

    // Convert map to array and sort by timestamp
    const result = Array.from(timeMap.values()).sort((a, b) => 
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );

    // If we have too much data, sample it to avoid overwhelming the frontend
    if (result.length > 100) {
      const step = Math.ceil(result.length / 100);
      return result.filter((_, index) => index % step === 0);
    }

    return result;
  }

  // Water supply duration methods using existing time series data
  async getWaterSupplySessions(deviceId: string, tankId: string, startTime: string, endTime: string): Promise<any> {
    return await this.influxService.getWaterSupplyDuration(deviceId, tankId, startTime, endTime);
  }

  async getWaterSupplyStats(deviceId: string, tankId: string, days: number = 30): Promise<any> {
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const result = await this.influxService.getWaterSupplyDuration(deviceId, tankId, startTime, endTime);
    
    return {
      device_id: deviceId,
      tank_id: tankId,
      period_days: days,
      stats: result.stats,
      sessions: result.sessions
    };
  }

  async getCurrentWaterSupplyStatus(deviceId: string): Promise<any> {
    // Get the latest water supply status for both tanks
    const latestData = await this.influxService.getLatestDeviceData(deviceId);
    
    const groundTankStatus = latestData.find(record => 
      record._measurement === 'water_levels' && 
      record.tank_id === 'ground' && 
      record._field === 'water_supply_on'
    );
    
    const roofTankStatus = latestData.find(record => 
      record._measurement === 'water_levels' && 
      record.tank_id === 'roof' && 
      record._field === 'water_supply_on'
    );
    
    return {
      device_id: deviceId,
      ground_tank: {
        water_supply_on: groundTankStatus?._value || false,
        last_update: groundTankStatus?._time || null
      },
      roof_tank: {
        water_supply_on: roofTankStatus?._value || false,
        last_update: roofTankStatus?._time || null
      }
    };
  }
} 