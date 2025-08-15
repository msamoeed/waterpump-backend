import {
  WebSocketGateway as NestWebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable, Inject, forwardRef } from '@nestjs/common';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  DeviceUpdateEvent,
  PumpEvent,
  AlertEvent,
  DeviceOfflineEvent,
  OTAUpdateEvent,
  SystemDataEvent,
  ProtectionResetResponseEvent,
  OTAUpdateResponseEvent,
  WaterSupplyNotificationEvent,
  SensorStatusNotificationEvent,
} from '../../common/interfaces/websocket-events.interface';
import { MotorService } from '../motor/motor.service';
import { DevicesService } from '../devices/devices.service';
import { RedisService } from '../../database/services/redis.service';
import { OneSignalService } from '../../common/services/onesignal.service';
import { PostgresService } from '../../database/services/postgres.service';

@Injectable()
@NestWebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/',
})
export class WebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server<ClientToServerEvents, ServerToClientEvents>;

  private logger: Logger = new Logger('WebSocketGateway');
  private connectedClients: Map<string, Set<string>> = new Map(); // deviceId -> Set of clientIds
  private otaUpdateSessions: Map<string, any> = new Map(); // deviceId -> OTA session data

  // Notification tracking for state changes
  private waterSupplyStates: Map<string, { ground: boolean; roof: boolean; system: boolean }> = new Map();
  private sensorConnectionStates: Map<string, { ground: { connected: boolean; working: boolean }; roof: { connected: boolean; working: boolean } }> = new Map();

  constructor(
    @Inject(forwardRef(() => MotorService)) private motorService: MotorService,
    @Inject(forwardRef(() => DevicesService)) private devicesService: DevicesService,
    private redisService: RedisService,
    private oneSignalService: OneSignalService,
    private postgresService: PostgresService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    // Remove client from all device subscriptions
    for (const [deviceId, clients] of this.connectedClients.entries()) {
      if (clients.has(client.id)) {
        clients.delete(client.id);
        if (clients.size === 0) {
          this.connectedClients.delete(deviceId);
        }
      }
    }
  }

  @SubscribeMessage('subscribe_device')
  handleSubscribeDevice(client: Socket, deviceId: string) {
    client.join(`device_${deviceId}`);
    
    // Track client subscription
    if (!this.connectedClients.has(deviceId)) {
      this.connectedClients.set(deviceId, new Set());
    }
    this.connectedClients.get(deviceId)?.add(client.id);
    
    this.logger.log(`Client ${client.id} subscribed to device ${deviceId}`);
    
    // Send current status if available
    this.handleGetCurrentStatus(client);
  }

  @SubscribeMessage('get_current_status')
  handleGetCurrentStatus(client: Socket) {
    // This would typically fetch current status from Redis/cache
    // For now, we'll just acknowledge the request
    client.emit('device_update', {
      device_id: 'unknown',
      status: null,
      timestamp: new Date().toISOString(),
    } as DeviceUpdateEvent);
  }

  @SubscribeMessage('subscribe_system_data')
  async handleSubscribeSystemData(client: Socket, deviceId: string) {
    client.join(`system_data_${deviceId}`);
    this.logger.log(`Client ${client.id} subscribed to system data for device ${deviceId}`);
    
    // Send current system data immediately
    await this.handleGetSystemData(client, deviceId);
  }

  @SubscribeMessage('get_system_data')
  async handleGetSystemData(client: Socket, deviceId: string) {
    try {
      const systemData = await this.fetchSystemData(deviceId);
      client.emit('system_data', systemData);
      this.logger.log(`System data sent to client ${client.id} for device ${deviceId}`);
    } catch (error) {
      this.logger.error(`Failed to fetch system data for device ${deviceId}: ${error.message}`);
      client.emit('system_data', {
        device_id: deviceId,
        motor_state: null,
        device_status: null,
        alerts: [],
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  }

  @SubscribeMessage('motor_control')
  async handleMotorControl(client: Socket, data: { device_id: string; action: 'start' | 'stop'; reason?: string }) {
    this.logger.log(`Motor control request for device ${data.device_id}: ${data.action}`);
    
    try {
      const result = await this.motorService.processMotorCommand({
        action: data.action,
        reason: data.reason || `${data.action === 'start' ? 'Manual start' : 'Manual stop'} from mobile app`,
        device_id: data.device_id,
        source: 'mobile',
      });

      // Send response back to client
      client.emit('motor_control_response', {
        device_id: data.device_id,
        success: result.success,
        action: data.action,
        message: `Motor ${data.action} command processed successfully`,
        motor_state: result.state,
        timestamp: new Date().toISOString(),
      });

      // Emit updated system data to all subscribers
      this.emitSystemDataUpdate(data.device_id);
      
    } catch (error) {
      this.logger.error(`Motor control error for device ${data.device_id}: ${error.message}`);
      client.emit('motor_control_response', {
        device_id: data.device_id,
        success: false,
        action: data.action,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('request_ota_update')
  async handleRequestOTAUpdate(client: Socket, deviceId: string) {
    this.logger.log(`OTA update requested for device ${deviceId}`);
    
    try {
      // Get latest release info from GitHub
      const latestRelease = await this.getLatestRelease();
      
      if (!latestRelease) {
        client.emit('ota_update_response', {
          success: false,
          error: 'No firmware releases available',
          device_id: deviceId,
        });
        return;
      }

      // Create OTA session
      const sessionData = {
        deviceId,
        release: latestRelease,
        status: 'initiated',
        startTime: new Date(),
        progress: 0,
      };
      
      this.otaUpdateSessions.set(deviceId, sessionData);
      
      // Emit OTA update event to device
      this.server.to(`device_${deviceId}`).emit('ota_update_available', {
        device_id: deviceId,
        version: latestRelease.version,
        download_url: latestRelease.firmware_url,
        manifest: latestRelease.manifest,
        timestamp: new Date().toISOString(),
      } as OTAUpdateEvent);
      
      client.emit('ota_update_response', {
        success: true,
        message: `OTA update initiated for version ${latestRelease.version}`,
        device_id: deviceId,
        version: latestRelease.version,
      });
      
    } catch (error) {
      this.logger.error(`OTA update request failed: ${error.message}`);
      client.emit('ota_update_response', {
        success: false,
        error: error.message,
        device_id: deviceId,
      });
    }
  }

  @SubscribeMessage('ota_progress')
  handleOTAProgress(client: Socket, data: { device_id: string; progress: number; status: string }) {
    this.logger.log(`OTA progress for device ${data.device_id}: ${data.progress}% - ${data.status}`);
    
    // Update session data
    const session = this.otaUpdateSessions.get(data.device_id);
    if (session) {
      session.progress = data.progress;
      session.status = data.status;
    }
    
    // Broadcast progress to all clients subscribed to this device
    this.server.to(`device_${data.device_id}`).emit('ota_progress_update', {
      device_id: data.device_id,
      progress: data.progress,
      status: data.status,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('ota_complete')
  handleOTAComplete(client: Socket, data: { device_id: string; success: boolean; version: string; error?: string }) {
    this.logger.log(`OTA update ${data.success ? 'completed' : 'failed'} for device ${data.device_id}`);
    
    // Clean up session
    this.otaUpdateSessions.delete(data.device_id);
    
    // Broadcast completion to all clients
    this.server.to(`device_${data.device_id}`).emit('ota_update_complete', {
      device_id: data.device_id,
      success: data.success,
      version: data.version,
      error: data.error,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('reset_protection')
  async handleResetProtection(client: Socket, data: { device_id: string; reason?: string }) {
    this.logger.log(`Protection reset requested for device ${data.device_id}: ${data.reason || 'No reason provided'}`);
    
    try {
      // Get current motor state to check if protection is actually active
      const motorState = await this.motorService.getMotorState(data.device_id);
      
      if (!motorState) {
        client.emit('protection_reset_response', {
          success: false,
          error: 'Device not found or motor state unavailable',
          device_id: data.device_id,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (!motorState.protectionActive) {
        client.emit('protection_reset_response', {
          success: false,
          error: 'Protection is not currently active',
          device_id: data.device_id,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Send protection reset command to the device via motor service
      const result = await this.motorService.processMotorCommand({
        action: 'reset_protection',
        reason: data.reason || 'Manual protection reset from mobile app',
        device_id: data.device_id,
        source: 'mobile',
      });

      if (result.success) {
        // Send success response to client
        client.emit('protection_reset_response', {
          success: true,
          message: 'Protection reset command sent successfully',
          device_id: data.device_id,
          reason: data.reason || 'Manual protection reset from mobile app',
          timestamp: new Date().toISOString(),
        });

        // Emit updated system data to all subscribers
        this.emitSystemDataUpdate(data.device_id);
        
        this.logger.log(`Protection reset successful for device ${data.device_id}`);
      } else {
        // Send failure response to client
        client.emit('protection_reset_response', {
          success: false,
          error: 'Failed to reset protection',
          device_id: data.device_id,
          timestamp: new Date().toISOString(),
        });
        
        this.logger.error(`Protection reset failed for device ${data.device_id}`);
      }
      
    } catch (error) {
      this.logger.error(`Protection reset error for device ${data.device_id}: ${error.message}`);
      client.emit('protection_reset_response', {
        success: false,
        error: error.message,
        device_id: data.device_id,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('get_sensor_status')
  async handleGetSensorStatus(client: Socket, deviceId: string) {
    this.logger.log(`Sensor status requested for device ${deviceId}`);
    
    try {
      // Import the sensor monitor service dynamically to avoid circular dependency
      const { SensorMonitorService } = await import('../motor/sensor-monitor.service');
      const sensorMonitorService = new SensorMonitorService(
        this.motorService,
        this.devicesService,
        this,
        this.redisService,
        this.postgresService
      );

      const pauseStatus = await sensorMonitorService.getSensorPauseStatus(deviceId);
      const isOverridden = await sensorMonitorService.isSensorMonitoringOverridden(deviceId);
      
      client.emit('sensor_status_response', {
        success: true,
        data: {
          device_id: deviceId,
          sensor_monitoring_active: !isOverridden,
          is_overridden: isOverridden,
          pause_status: pauseStatus,
          timestamp: new Date().toISOString(),
        },
      });
      
    } catch (error) {
      this.logger.error(`Failed to get sensor status for device ${deviceId}: ${error.message}`);
      client.emit('sensor_status_response', {
        success: false,
        error: error.message,
        device_id: deviceId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('override_sensor_monitoring')
  async handleOverrideSensorMonitoring(client: Socket, data: { device_id: string; enable: boolean; reason?: string }) {
    this.logger.log(`Sensor monitoring override requested for device ${data.device_id}: ${data.enable ? 'enable' : 'disable'}`);
    
    try {
      // Import the sensor monitor service dynamically to avoid circular dependency
      const { SensorMonitorService } = await import('../motor/sensor-monitor.service');
      const sensorMonitorService = new SensorMonitorService(
        this.motorService,
        this.devicesService,
        this,
        this.redisService,
        this.postgresService
      );

      await sensorMonitorService.overrideSensorMonitoring(
        data.device_id, 
        data.enable, 
        data.reason
      );
      
      client.emit('sensor_override_response', {
        success: true,
        message: `Sensor monitoring ${data.enable ? 'overridden' : 'enabled'} successfully`,
        data: {
          device_id: data.device_id,
          override_enabled: data.enable,
          reason: data.reason,
          timestamp: new Date().toISOString(),
        },
      });
      
    } catch (error) {
      this.logger.error(`Failed to override sensor monitoring for device ${data.device_id}: ${error.message}`);
      client.emit('sensor_override_response', {
        success: false,
        error: error.message,
        device_id: data.device_id,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('force_sensor_check')
  async handleForceSensorCheck(client: Socket, deviceId: string) {
    this.logger.log(`Forced sensor check requested for device ${deviceId}`);
    
    try {
      // Import the sensor monitor service dynamically to avoid circular dependency
      const { SensorMonitorService } = await import('../motor/sensor-monitor.service');
      const sensorMonitorService = new SensorMonitorService(
        this.motorService,
        this.devicesService,
        this,
        this.redisService,
        this.postgresService
      );

      await sensorMonitorService.forceSensorStatusCheck(deviceId);
      
      client.emit('sensor_check_response', {
        success: true,
        message: 'Sensor status check completed successfully',
        data: {
          device_id: deviceId,
          timestamp: new Date().toISOString(),
        },
      });
      
    } catch (error) {
      this.logger.error(`Failed to perform sensor check for device ${deviceId}: ${error.message}`);
      client.emit('sensor_check_response', {
        success: false,
        error: error.message,
        device_id: deviceId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Methods to emit events to connected clients
  emitDeviceUpdate(deviceId: string, data: DeviceUpdateEvent) {
    this.server.to(`device_${deviceId}`).emit('device_update', data);
    this.logger.log(`Device update emitted for device ${deviceId}`);
  }

  emitPumpEvent(data: PumpEvent) {
    this.server.emit('pump_event', data);
    this.logger.log(`Pump event emitted: ${data.event_type}`);
  }

  emitAlert(data: AlertEvent) {
    this.server.emit('alert_triggered', data);
    this.logger.log(`Alert emitted: ${data.alert_type} - ${data.severity}`);
  }

  emitDeviceOffline(data: DeviceOfflineEvent) {
    this.server.emit('device_offline', data);
    this.logger.log(`Device offline event emitted for device ${data.device_id}`);
  }

  emitOTAUpdate(deviceId: string, data: OTAUpdateEvent) {
    this.server.to(`device_${deviceId}`).emit('ota_update_available', data);
    this.logger.log(`OTA update event emitted for device ${deviceId}`);
  }

  emitDeviceLog(deviceId: string, data: { level: string; message: string; timestamp?: string }) {
    const payload = {
      device_id: deviceId,
      level: (data.level || 'info') as any,
      message: data.message,
      timestamp: data.timestamp || new Date().toISOString(),
    };
    this.server.to(`device_${deviceId}`).emit('device_log', payload);
  }

  // New notification methods
  emitWaterSupplyNotification(deviceId: string, tankId: 'ground' | 'roof' | 'system', currentState: boolean, previousState: boolean, reason?: string) {
    const notification: WaterSupplyNotificationEvent = {
      device_id: deviceId,
      tank_id: tankId,
      water_supply_on: currentState,
      previous_state: previousState,
      timestamp: new Date().toISOString(),
      reason: reason,
    };
    
    this.server.to(`device_${deviceId}`).emit('water_supply_notification', notification);
    this.logger.log(`Water supply notification emitted for device ${deviceId}, tank ${tankId}: ${previousState} -> ${currentState}`);
    
    // Send OneSignal push notification
    this.oneSignalService.sendWaterSupplyNotification(deviceId, tankId, currentState, previousState);
  }

  emitSensorStatusNotification(deviceId: string, tankId: 'ground' | 'roof', connected: boolean, working: boolean, previousConnected: boolean, previousWorking: boolean, reason?: string) {
    const notification: SensorStatusNotificationEvent = {
      device_id: deviceId,
      tank_id: tankId,
      sensor_connected: connected,
      sensor_working: working,
      previous_connected: previousConnected,
      previous_working: previousWorking,
      timestamp: new Date().toISOString(),
      reason: reason,
    };
    
    this.server.to(`device_${deviceId}`).emit('sensor_status_notification', notification);
    this.logger.log(`Sensor status notification emitted for device ${deviceId}, tank ${tankId}: connected ${previousConnected}->${connected}, working ${previousWorking}->${working}`);
    
    // Send OneSignal push notification
    this.oneSignalService.sendSensorStatusNotification(deviceId, tankId, connected, working, previousConnected, previousWorking);
  }

  async emitSystemDataUpdate(deviceId: string) {
    try {
      const systemData = await this.fetchSystemData(deviceId);
      this.server.to(`system_data_${deviceId}`).emit('system_data', systemData);
      this.logger.log(`System data update emitted for device ${deviceId}`);
      
      // Check for state changes and emit notifications
      this.checkAndEmitNotifications(deviceId, systemData);
    } catch (error) {
      this.logger.error(`Failed to emit system data update for device ${deviceId}: ${error.message}`);
    }
  }

  // Check for state changes and emit notifications
  private checkAndEmitNotifications(deviceId: string, systemData: SystemDataEvent) {
    // Check water supply status changes
    this.checkWaterSupplyChanges(deviceId, systemData);
    
    // Check sensor status changes
    this.checkSensorStatusChanges(deviceId, systemData);
  }

  private checkWaterSupplyChanges(deviceId: string, systemData: SystemDataEvent) {
    const currentStates = {
      ground: systemData.device_status?.ground_tank?.water_supply_on || false,
      roof: systemData.device_status?.roof_tank?.water_supply_on || false,
      system: systemData.device_status?.system?.water_supply_active || false,
    };

    const previousStates = this.waterSupplyStates.get(deviceId) || { ground: false, roof: false, system: false };

    // Check ground tank water supply changes
    if (currentStates.ground !== previousStates.ground) {
      this.emitWaterSupplyNotification(
        deviceId,
        'ground',
        currentStates.ground,
        previousStates.ground,
        currentStates.ground ? 'Water supply activated' : 'Water supply deactivated'
      );
    }

    // Check roof tank water supply changes
    if (currentStates.roof !== previousStates.roof) {
      this.emitWaterSupplyNotification(
        deviceId,
        'roof',
        currentStates.roof,
        previousStates.roof,
        currentStates.roof ? 'Water supply activated' : 'Water supply deactivated'
      );
    }

    // Check system water supply changes
    if (currentStates.system !== previousStates.system) {
      this.emitWaterSupplyNotification(
        deviceId,
        'system',
        currentStates.system,
        previousStates.system,
        currentStates.system ? 'System water supply active' : 'System water supply inactive'
      );
    }

    // Update stored states
    this.waterSupplyStates.set(deviceId, currentStates);
  }

  private checkSensorStatusChanges(deviceId: string, systemData: SystemDataEvent) {
    const currentGroundStatus = {
      connected: systemData.device_status?.ground_tank?.connected || false,
      working: systemData.device_status?.ground_tank?.sensor_working || false,
    };

    const currentRoofStatus = {
      connected: systemData.device_status?.roof_tank?.connected || false,
      working: systemData.device_status?.roof_tank?.sensor_working || false,
    };

    const previousStates = this.sensorConnectionStates.get(deviceId) || {
      ground: { connected: false, working: false },
      roof: { connected: false, working: false },
    };

    // Check ground tank sensor changes
    if (currentGroundStatus.connected !== previousStates.ground.connected || 
        currentGroundStatus.working !== previousStates.ground.working) {
      this.emitSensorStatusNotification(
        deviceId,
        'ground',
        currentGroundStatus.connected,
        currentGroundStatus.working,
        previousStates.ground.connected,
        previousStates.ground.working,
        this.getSensorStatusChangeReason(currentGroundStatus, previousStates.ground)
      );
    }

    // Check roof tank sensor changes
    if (currentRoofStatus.connected !== previousStates.roof.connected || 
        currentRoofStatus.working !== previousStates.roof.working) {
      this.emitSensorStatusNotification(
        deviceId,
        'roof',
        currentRoofStatus.connected,
        currentRoofStatus.working,
        previousStates.roof.connected,
        previousStates.roof.working,
        this.getSensorStatusChangeReason(currentRoofStatus, previousStates.roof)
      );
    }

    // Update stored states
    this.sensorConnectionStates.set(deviceId, {
      ground: currentGroundStatus,
      roof: currentRoofStatus,
    });
  }

  private getSensorStatusChangeReason(current: { connected: boolean; working: boolean }, previous: { connected: boolean; working: boolean }): string {
    if (current.connected !== previous.connected) {
      return current.connected ? 'Sensor reconnected' : 'Sensor disconnected';
    }
    if (current.working !== previous.working) {
      return current.working ? 'Sensor working again' : 'Sensor malfunction detected';
    }
    return 'Status change detected';
  }

  // Utility methods
  getConnectedClientsCount(deviceId?: string): number {
    if (deviceId) {
      return this.connectedClients.get(deviceId)?.size || 0;
    }
    return this.server.engine.clientsCount;
  }

  getSubscribedDevices(): string[] {
    return Array.from(this.connectedClients.keys());
  }

  getOTASessions(): any[] {
    return Array.from(this.otaUpdateSessions.values());
  }

  private async fetchSystemData(deviceId: string): Promise<SystemDataEvent> {
    try {
      // Fetch motor state
      const motorState = await this.motorService.getMotorState(deviceId);
      
      // Fetch device status
      const deviceStatus = await this.devicesService.getCurrentStatus(deviceId);
      
      // Fetch active alerts
      const alertsData = await this.redisService.getActiveAlerts(deviceId);
      const alerts = Object.entries(alertsData).map(([id, alertStr]) => {
        try {
          const alert = JSON.parse(alertStr);
          return {
            id,
            type: alert.type || 'unknown',
            message: alert.message || 'No message',
            severity: alert.severity || 'medium',
            created_at: alert.created_at || new Date().toISOString(),
            expires_at: alert.expires_at,
          };
        } catch (error) {
          return {
            id,
            type: 'parse_error',
            message: 'Failed to parse alert data',
            severity: 'low' as const,
            created_at: new Date().toISOString(),
          };
        }
      });

      return {
        device_id: deviceId,
        motor_state: motorState ? {
          motorRunning: motorState.motorRunning,
          controlMode: motorState.controlMode,
          targetModeActive: motorState.targetModeActive,
          currentTargetLevel: motorState.currentTargetLevel,
          targetDescription: motorState.targetDescription,
          protectionActive: motorState.protectionActive,
          currentAmps: motorState.currentAmps,
          powerWatts: motorState.powerWatts,
          runtimeMinutes: motorState.runtimeMinutes,
          totalRuntimeHours: motorState.totalRuntimeHours,
          mcuOnline: motorState.mcuOnline,
          lastCommandSource: motorState.lastCommandSource,
          lastCommandReason: motorState.lastCommandReason,
          // Pending states
          pendingMotorRunning: motorState.pendingMotorRunning,
          pendingControlMode: motorState.pendingControlMode,
          pendingTargetActive: motorState.pendingTargetActive,
          pendingTargetLevel: motorState.pendingTargetLevel,
          pendingCommandId: motorState.pendingCommandId,
          pendingCommandTimestamp: motorState.pendingCommandTimestamp ? 
            (motorState.pendingCommandTimestamp instanceof Date ? 
              motorState.pendingCommandTimestamp.toISOString() : 
              motorState.pendingCommandTimestamp) : undefined,
        } : null,
        device_status: deviceStatus,
        alerts,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error fetching system data for device ${deviceId}: ${error.message}`);
      throw error;
    }
  }

  private async getLatestRelease(): Promise<any> {
    try {
      const response = await fetch('https://api.github.com/repos/msamoeed/waterpump-mcu/releases/latest');
      const release = await response.json();
      
      // Find firmware.bin asset
      const firmwareAsset = release.assets.find((asset: any) => asset.name === 'firmware.bin');
      const manifestAsset = release.assets.find((asset: any) => asset.name === 'manifest.json');
      
      if (!firmwareAsset) {
        throw new Error('Firmware binary not found in latest release');
      }

      // Get manifest data
      let manifest = null;
      if (manifestAsset) {
        const manifestResponse = await fetch(manifestAsset.browser_download_url);
        manifest = await manifestResponse.json();
      }

      return {
        version: release.tag_name,
        firmware_url: firmwareAsset.browser_download_url,
        manifest: manifest,
        release_date: release.published_at,
        description: release.body,
      };
    } catch (error) {
      this.logger.error(`Failed to get latest release: ${error.message}`);
      return null;
    }
  }
} 