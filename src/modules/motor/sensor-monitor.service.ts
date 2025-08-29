import { Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { MotorService } from './motor.service';
import { DevicesService } from '../devices/devices.service';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';
import { WebSocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class SensorMonitorService implements OnModuleInit, OnModuleDestroy {
  private sensorCheckInterval: NodeJS.Timeout;
  private readonly SENSOR_CHECK_INTERVAL = 10000; // 10 seconds
  private readonly SENSOR_OFFLINE_THRESHOLD = 30000; // 30 seconds

  constructor(
    private readonly motorService: MotorService,
    @Inject(forwardRef(() => DevicesService)) private readonly devicesService: DevicesService,
    @Inject(forwardRef(() => WebSocketGateway)) private readonly eventEmitter: WebSocketGateway,
    private readonly redisService: RedisService,
    private readonly postgresService: PostgresService,
  ) {
    // Log if eventEmitter is not available during initialization
    if (!this.eventEmitter) {
      console.warn('WebSocketGateway not available during SensorMonitorService initialization');
    }
  }

  onModuleInit() {
    // Start monitoring sensors every 10 seconds
    this.sensorCheckInterval = setInterval(async () => {
      try {
        await this.checkSensorStatusAndControlPump();
      } catch (error) {
        console.error('Error in sensor monitoring:', error);
      }
    }, this.SENSOR_CHECK_INTERVAL);

    console.log('Sensor monitoring service started');
  }

  onModuleDestroy() {
    if (this.sensorCheckInterval) {
      clearInterval(this.sensorCheckInterval);
    }
  }

  /**
   * Check sensor status and automatically control the roof pump
   */
  private async checkSensorStatusAndControlPump(): Promise<void> {
    try {
      // Get all device keys from Redis
      const deviceKeys = await this.redisService.getDeviceKeys();
      
      for (const key of deviceKeys) {
        const deviceId = key.split(':')[1];
        await this.processDeviceSensors(deviceId);
      }
    } catch (error) {
      console.error('Error checking sensor status:', error);
    }
  }

  /**
   * Process sensors for a specific device
   */
  private async processDeviceSensors(deviceId: string): Promise<void> {
    try {
      // Check if sensor monitoring is overridden
      const isOverridden = await this.isSensorMonitoringOverridden(deviceId);
      if (isOverridden) {
        console.log(`Sensor monitoring overridden for device ${deviceId}, skipping automatic control`);
        return;
      }

      // Get current sensor status from Redis (fast, lightweight)
      const sensorStatusKey = `sensor:${deviceId}:status`;
      const sensorStatusData = await this.redisService.get(sensorStatusKey);
      
      if (!sensorStatusData) {
        console.log(`No sensor status found for device ${deviceId}, skipping`);
        return;
      }

      const sensorStatus = JSON.parse(sensorStatusData);
      
      // Check sensor connectivity and functionality from Redis
      const groundSensorConnected = sensorStatus.ground_tank?.connected || false;
      const roofSensorConnected = sensorStatus.roof_tank?.connected || false;
      const groundSensorWorking = sensorStatus.ground_tank?.sensor_working || false;
      const roofSensorWorking = sensorStatus.roof_tank?.sensor_working || false;

      // Get current motor state
      const motorState = await this.motorService.getMotorState(deviceId);
      
      // Determine if we should pause or resume the pump
      const shouldPausePump = !groundSensorConnected || !roofSensorConnected || 
                              !groundSensorWorking || !roofSensorWorking;
      
      const isPumpRunning = motorState.motorRunning;
      const isPausedBySensor = motorState.lastCommandReason?.includes('Sensor offline');

      // Emit sensor status update via WebSocket
      this.emitSensorStatusUpdate(deviceId, {
        groundSensorConnected,
        roofSensorConnected,
        groundSensorWorking,
        roofSensorWorking,
        pumpRunning: isPumpRunning,
        isPausedBySensor
      });

      if (shouldPausePump && isPumpRunning && !isPausedBySensor) {
        // Pause the pump due to sensor issues
        await this.pausePumpDueToSensors(deviceId, {
          groundSensorConnected,
          roofSensorConnected,
          groundSensorWorking,
          roofSensorWorking
        });
      } else if (!shouldPausePump && isPausedBySensor) {
        // Resume the pump as sensors are working again
        await this.resumePumpAfterSensorRecovery(deviceId, {
          groundSensorConnected,
          roofSensorConnected,
          groundSensorWorking,
          roofSensorWorking
        });
      }

      // Log sensor status for monitoring
      await this.logSensorStatus(deviceId, {
        groundSensorConnected,
        roofSensorConnected,
        groundSensorWorking,
        roofSensorWorking,
        pumpRunning: isPumpRunning,
        isPausedBySensor
      });

    } catch (error) {
      console.error(`Error processing device ${deviceId} sensors:`, error);
    }
  }

  /**
   * Pause the roof pump due to sensor issues
   */
  private async pausePumpDueToSensors(deviceId: string, sensorStatus: {
    groundSensorConnected: boolean;
    roofSensorConnected: boolean;
    groundSensorWorking: boolean;
    roofSensorWorking: boolean;
  }): Promise<void> {
    try {
      console.log(`Pausing roof pump for device ${deviceId} due to sensor issues:`, sensorStatus);

      // Get current device status from Redis for detailed information
      const deviceStatusKey = `device:${deviceId}:status`;
      const deviceStatusData = await this.redisService.get(deviceStatusKey);
      const deviceStatus = deviceStatusData ? JSON.parse(deviceStatusData) : null;
      
      const motorState = await this.motorService.getMotorState(deviceId);

      // Determine error types for each sensor using Redis data
      const groundSensorError = this.determineSensorError(sensorStatus.groundSensorConnected, sensorStatus.groundSensorWorking, deviceStatus?.ground_tank);
      const roofSensorError = this.determineSensorError(sensorStatus.roofSensorConnected, sensorStatus.roofSensorWorking, deviceStatus?.roof_tank);

      // Calculate estimated resume time based on sensor issues
      const estimatedResumeTime = this.calculateEstimatedResumeTime(groundSensorError, roofSensorError);
      
      // Determine if manual intervention is required
      const requiresManualIntervention = this.requiresManualIntervention(groundSensorError, roofSensorError);

      // Stop the motor
      await this.motorService.processMotorCommand({
        device_id: deviceId,
        action: 'stop',
        reason: `Sensor offline - Ground: ${sensorStatus.groundSensorConnected ? 'OK' : 'OFFLINE'}, Roof: ${sensorStatus.roofSensorConnected ? 'OK' : 'OFFLINE'}`,
        source: 'auto'
      });

      // Emit detailed pump pause event via WebSocket
      this.emitDetailedPumpPauseEvent(deviceId, {
        groundSensorError,
        roofSensorError,
        deviceStatus,
        motorState,
        estimatedResumeTime,
        requiresManualIntervention
      });

      // Also emit to all clients for system-wide notification
      this.eventEmitter.emitSystemAlert({
        type: 'pump_paused',
        severity: 'high',
        message: `Device ${deviceId}: Roof pump paused due to sensor issues - ${requiresManualIntervention ? 'Manual intervention required' : 'Automatic recovery expected'}`,
        device_id: deviceId,
        timestamp: new Date().toISOString()
      });

      // Also emit the basic pump pause event for backward compatibility
      this.emitPumpPauseEvent(deviceId, {
        reason: `Sensor offline - Ground: ${sensorStatus.groundSensorConnected ? 'OK' : 'OFFLINE'}, Roof: ${sensorStatus.roofSensorConnected ? 'OK' : 'OFFLINE'}`,
        sensorStatus,
        timestamp: new Date().toISOString()
      });

      // Log the event
      await this.postgresService.insertEventLog({
        device_id: deviceId,
        event_type: 'pump_paused_sensor',
        message: `Roof pump paused due to sensor issues - Ground sensor: ${sensorStatus.groundSensorConnected ? 'connected' : 'disconnected'}, Roof sensor: ${sensorStatus.roofSensorConnected ? 'connected' : 'disconnected'}`,
        severity: 'high'
      });

      // Store sensor pause state in Redis for tracking
      await this.redisService.set(
        `sensor_pause:${deviceId}`,
        JSON.stringify({
          pausedAt: new Date().toISOString(),
          reason: 'Sensor offline',
          sensorStatus,
          previousMotorState: 'running',
          estimatedResumeTime,
          requiresManualIntervention,
          groundSensorError,
          roofSensorError
        }),
        3600 // 1 hour TTL
      );

    } catch (error) {
      console.error(`Error pausing pump for device ${deviceId}:`, error);
    }
  }

  /**
   * Determine the specific error type for a sensor
   */
  private determineSensorError(connected: boolean, working: boolean, tankData?: any): {
    error_type: 'disconnected' | 'no_data' | 'invalid_reading' | 'timeout' | 'none';
    last_reading?: number;
    last_reading_time?: string;
  } {
    if (!connected) {
      return {
        error_type: 'disconnected',
        last_reading: tankData?.level_percent,
        last_reading_time: tankData?.last_update
      };
    }
    
    if (!working) {
      if (tankData?.level_percent === undefined || tankData?.level_percent === null) {
        return {
          error_type: 'no_data',
          last_reading: tankData?.level_percent,
          last_reading_time: tankData?.last_update
        };
      }
      
      // Check for invalid readings (e.g., negative values, values > 100%)
      if (tankData.level_percent < 0 || tankData.level_percent > 100) {
        return {
          error_type: 'invalid_reading',
          last_reading: tankData.level_percent,
          last_reading_time: tankData?.last_update
        };
      }
      
      return {
        error_type: 'timeout',
        last_reading: tankData.level_percent,
        last_reading_time: tankData?.last_update
      };
    }
    
    return {
      error_type: 'none',
      last_reading: tankData?.level_percent,
      last_reading_time: tankData?.last_update
    };
  }

  /**
   * Calculate estimated resume time based on sensor issues
   */
  private calculateEstimatedResumeTime(groundError: any, roofError: any): string {
    const now = new Date();
    
    // Base time for sensor recovery
    let estimatedMinutes = 5; // Default 5 minutes
    
    // Add time based on error types
    if (groundError.error_type === 'disconnected') estimatedMinutes += 10;
    if (roofError.error_type === 'disconnected') estimatedMinutes += 10;
    if (groundError.error_type === 'timeout') estimatedMinutes += 3;
    if (roofError.error_type === 'timeout') estimatedMinutes += 3;
    if (groundError.error_type === 'invalid_reading') estimatedMinutes += 2;
    if (roofError.error_type === 'invalid_reading') estimatedMinutes += 2;
    
    const estimatedTime = new Date(now.getTime() + estimatedMinutes * 60 * 1000);
    return estimatedTime.toISOString();
  }

  /**
   * Determine if manual intervention is required
   */
  private requiresManualIntervention(groundError: any, roofError: any): boolean {
    // Manual intervention required if both sensors are disconnected
    if (groundError.error_type === 'disconnected' && roofError.error_type === 'disconnected') {
      return true;
    }
    
    // Manual intervention required if sensors have been down for extended period
    // This would be checked in a separate monitoring service
    
    return false;
  }

  /**
   * Emit detailed pump pause event via WebSocket
   */
  private emitDetailedPumpPauseEvent(deviceId: string, data: {
    groundSensorError: any;
    roofSensorError: any;
    deviceStatus: any;
    motorState: any;
    estimatedResumeTime: string;
    requiresManualIntervention: boolean;
  }): void {
    try {
      // Check if eventEmitter is available
      if (!this.eventEmitter) {
        console.warn(`Event emitter not available for device ${deviceId}, skipping detailed pump pause event`);
        return;
      }

      const pauseDetails = {
        device_id: deviceId,
        pause_reason: 'sensor_offline' as const,
        pause_details: {
          ground_sensor: {
            connected: data.deviceStatus?.ground_tank?.connected || false,
            working: data.deviceStatus?.ground_tank?.sensor_working || false,
            last_reading: data.groundSensorError.last_reading,
            last_reading_time: data.groundSensorError.last_reading_time,
            error_type: data.groundSensorError.error_type
          },
          roof_sensor: {
            connected: data.deviceStatus?.roof_tank?.connected || false,
            working: data.deviceStatus?.roof_tank?.sensor_working || false,
            last_reading: data.roofSensorError.last_reading,
            last_reading_time: data.roofSensorError.last_reading_time,
            error_type: data.roofSensorError.error_type
          },
          pump_state_before_pause: {
            running: data.motorState.motorRunning || false,
            mode: data.motorState.controlMode || 'auto',
            target_level: data.motorState.currentTargetLevel,
            runtime_minutes: data.motorState.runtimeMinutes || 0
          },
          estimated_resume_time: data.estimatedResumeTime,
          requires_manual_intervention: data.requiresManualIntervention
        },
        timestamp: new Date().toISOString(),
        severity: (data.requiresManualIntervention ? 'critical' : 'high') as 'high' | 'critical'
      };

      this.eventEmitter.emitPumpPauseDetails(deviceId, pauseDetails);

      // Also emit to all clients for system-wide notification
      this.eventEmitter.emitSystemAlert({
        type: 'pump_paused',
        severity: pauseDetails.severity,
        message: `Device ${deviceId}: Roof pump paused due to sensor issues - ${data.requiresManualIntervention ? 'Manual intervention required' : 'Automatic recovery expected'}`,
        device_id: deviceId,
        timestamp: pauseDetails.timestamp
      });

    } catch (error) {
      console.error(`Error emitting detailed pump pause event for device ${deviceId}:`, error);
    }
  }

  /**
   * Resume the roof pump after sensor recovery
   */
  private async resumePumpAfterSensorRecovery(deviceId: string, sensorStatus: {
    groundSensorConnected: boolean;
    roofSensorConnected: boolean;
    groundSensorWorking: boolean;
    roofSensorWorking: boolean;
  }): Promise<void> {
    try {
      console.log(`Resuming roof pump for device ${deviceId} after sensor recovery:`, sensorStatus);

      // Get the previous motor state before it was paused
      const pauseData = await this.redisService.get(`sensor_pause:${deviceId}`);
      let previousState = 'stopped';
      
      if (pauseData) {
        const pauseInfo = JSON.parse(pauseData);
        previousState = pauseInfo.previousMotorState || 'stopped';
      }

      // Resume based on previous state
      if (previousState === 'running') {
        await this.motorService.processMotorCommand({
          device_id: deviceId,
          action: 'start',
          reason: 'Sensors recovered - resuming pump operation',
          source: 'auto'
        });

        // Emit pump resume event via WebSocket
        this.emitPumpResumeEvent(deviceId, {
          reason: 'Sensors recovered',
          sensorStatus,
          timestamp: new Date().toISOString()
        });
      }

      // Log the event
      await this.postgresService.insertEventLog({
        device_id: deviceId,
        event_type: 'pump_resumed_sensor',
        message: `Roof pump resumed after sensor recovery - Ground sensor: ${sensorStatus.groundSensorConnected ? 'connected' : 'disconnected'}, Roof sensor: ${sensorStatus.roofSensorConnected ? 'connected' : 'disconnected'}`,
        severity: 'info'
      });

      // Clear the sensor pause state
      await this.redisService.del(`sensor_pause:${deviceId}`);

    } catch (error) {
      console.error(`Error resuming pump for device ${deviceId}:`, error);
    }
  }

  /**
   * Emit sensor status update via WebSocket
   */
  private emitSensorStatusUpdate(deviceId: string, status: {
    groundSensorConnected: boolean;
    roofSensorConnected: boolean;
    groundSensorWorking: boolean;
    roofSensorWorking: boolean;
    pumpRunning: boolean;
    isPausedBySensor: boolean;
  }): void {
    try {
      // Check if eventEmitter is available
      if (!this.eventEmitter) {
        console.warn(`Event emitter not available for device ${deviceId}, skipping sensor status update`);
        return;
      }

      // Emit to all clients subscribed to this device
      this.eventEmitter.emitSensorMonitoringUpdate(deviceId, {
        device_id: deviceId,
        ground_sensor: {
          connected: status.groundSensorConnected,
          working: status.groundSensorWorking
        },
        roof_sensor: {
          connected: status.roofSensorConnected,
          working: status.roofSensorWorking
        },
        pump_status: {
          running: status.pumpRunning,
          paused_by_sensor: status.isPausedBySensor
        },
        timestamp: new Date().toISOString()
      });

      // Also emit system data update to refresh the dashboard
      this.eventEmitter.emitSystemDataUpdate(deviceId);

    } catch (error) {
      console.error(`Error emitting sensor status update for device ${deviceId}:`, error);
    }
  }

  /**
   * Emit pump pause event via WebSocket
   */
  private emitPumpPauseEvent(deviceId: string, data: {
    reason: string;
    sensorStatus: any;
    timestamp: string;
  }): void {
    try {
      // Check if eventEmitter is available
      if (!this.eventEmitter) {
        console.warn(`Event emitter not available for device ${deviceId}, skipping pump pause event`);
        return;
      }

      this.eventEmitter.emitPumpPauseEvent(deviceId, {
        device_id: deviceId,
        reason: data.reason,
        sensor_status: data.sensorStatus,
        timestamp: data.timestamp,
        action: 'paused'
      });

      // Emit to all clients for system-wide notification
      this.eventEmitter.emitSystemAlert({
        type: 'sensor_offline',
        severity: 'high',
        message: `Device ${deviceId}: Roof pump paused due to sensor issues`,
        device_id: deviceId,
        timestamp: data.timestamp
      });

    } catch (error) {
      console.error(`Error emitting pump pause event for device ${deviceId}:`, error);
    }
  }

  /**
   * Emit pump resume event via WebSocket
   */
  private emitPumpResumeEvent(deviceId: string, data: {
    reason: string;
    sensorStatus: any;
    timestamp: string;
  }): void {
    try {
      // Check if eventEmitter is available
      if (!this.eventEmitter) {
        console.warn(`Event emitter not available for device ${deviceId}, skipping pump resume event`);
        return;
      }

      this.eventEmitter.emitPumpResumeEvent(deviceId, {
        device_id: deviceId,
        reason: data.reason,
        sensor_status: data.sensorStatus,
        timestamp: data.timestamp,
        action: 'resumed'
      });

      // Emit to all clients for system-wide notification
      this.eventEmitter.emitSystemAlert({
        type: 'sensor_recovered',
        severity: 'medium',
        message: `Device ${deviceId}: Roof pump resumed after sensor recovery`,
        device_id: deviceId,
        timestamp: data.timestamp
      });

    } catch (error) {
      console.error(`Error emitting pump resume event for device ${deviceId}:`, error);
    }
  }

  /**
   * Log sensor status for monitoring
   */
  private async logSensorStatus(deviceId: string, status: {
    groundSensorConnected: boolean;
    roofSensorConnected: boolean;
    groundSensorWorking: boolean;
    roofSensorWorking: boolean;
    pumpRunning: boolean;
    isPausedBySensor: boolean;
  }): Promise<void> {
    try {
      // Only log if there are issues or status changes
      const hasIssues = !status.groundSensorConnected || !status.roofSensorConnected || 
                       !status.groundSensorWorking || !status.roofSensorWorking;
      
      if (hasIssues || status.isPausedBySensor) {
        await this.postgresService.insertEventLog({
          device_id: deviceId,
          event_type: 'sensor_status',
          message: `Sensor status - Ground: ${status.groundSensorConnected ? 'connected' : 'disconnected'} (${status.groundSensorWorking ? 'working' : 'not working'}), Roof: ${status.roofSensorConnected ? 'connected' : 'disconnected'} (${status.roofSensorWorking ? 'working' : 'not working'}), Pump: ${status.pumpRunning ? 'running' : 'stopped'}, Paused by sensor: ${status.isPausedBySensor}`,
          severity: hasIssues ? 'warning' : 'info'
        });
      }
    } catch (error) {
      console.error(`Error logging sensor status for device ${deviceId}:`, error);
    }
  }

  /**
   * Get current sensor pause status for a device
   */
  async getSensorPauseStatus(deviceId: string): Promise<any> {
    try {
      const pauseData = await this.redisService.get(`sensor_pause:${deviceId}`);
      if (pauseData) {
        return JSON.parse(pauseData);
      }
      return null;
    } catch (error) {
      console.error(`Error getting sensor pause status for device ${deviceId}:`, error);
      return null;
    }
  }

  /**
   * Manually override sensor monitoring for a device
   */
  async overrideSensorMonitoring(deviceId: string, override: boolean, reason?: string): Promise<void> {
    try {
      if (override) {
        // Enable override
        await this.redisService.set(
          `sensor_override:${deviceId}`,
          JSON.stringify({
            enabled: true,
            reason: reason || 'Manual override',
            timestamp: new Date().toISOString()
          }),
          86400 // 24 hours TTL
        );
        
        console.log(`Sensor monitoring override enabled for device ${deviceId}: ${reason}`);

        // Emit override event via WebSocket
        this.emitSensorOverrideEvent(deviceId, {
          enabled: true,
          reason: reason || 'Manual override',
          timestamp: new Date().toISOString()
        });
      } else {
        // Disable override
        await this.redisService.del(`sensor_override:${deviceId}`);
        console.log(`Sensor monitoring override disabled for device ${deviceId}`);

        // Emit override event via WebSocket
        this.emitSensorOverrideEvent(deviceId, {
          enabled: false,
          reason: 'Override disabled',
          timestamp: new Date().toISOString()
        });
      }

      // Log the override action
      await this.postgresService.insertEventLog({
        device_id: deviceId,
        event_type: 'sensor_override',
        message: `Sensor monitoring ${override ? 'enabled' : 'disabled'} - ${reason || 'No reason provided'}`,
        severity: 'info'
      });

    } catch (error) {
      console.error(`Error setting sensor override for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Emit sensor override event via WebSocket
   */
  private emitSensorOverrideEvent(deviceId: string, data: {
    enabled: boolean;
    reason: string;
    timestamp: string;
  }): void {
    try {
      // Check if eventEmitter is available
      if (!this.eventEmitter) {
        console.warn(`Event emitter not available for device ${deviceId}, skipping sensor override event`);
        return;
      }

      this.eventEmitter.emitSensorOverrideUpdate(deviceId, {
        device_id: deviceId,
        override_enabled: data.enabled,
        reason: data.reason,
        timestamp: data.timestamp
      });

      // Also emit system data update to refresh the dashboard
      this.eventEmitter.emitSystemDataUpdate(deviceId);

    } catch (error) {
      console.error(`Error emitting sensor override event for device ${deviceId}:`, error);
    }
  }

  /**
   * Check if sensor monitoring is overridden for a device
   */
  async isSensorMonitoringOverridden(deviceId: string): Promise<boolean> {
    try {
      const overrideData = await this.redisService.get(`sensor_override:${deviceId}`);
      if (overrideData) {
        const override = JSON.parse(overrideData);
        return override.enabled === true;
      }
      return false;
    } catch (error) {
      console.error(`Error checking sensor override for device ${deviceId}:`, error);
      return false;
    }
  }

  /**
   * Force sensor status check and emit update (for manual triggers)
   */
  async forceSensorStatusCheck(deviceId: string): Promise<void> {
    try {
      await this.processDeviceSensors(deviceId);
      console.log(`Forced sensor status check completed for device ${deviceId}`);
    } catch (error) {
      console.error(`Error in forced sensor status check for device ${deviceId}:`, error);
      throw error;
    }
  }
}
