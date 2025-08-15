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
} from '../../common/interfaces/websocket-events.interface';
import { MotorService } from '../motor/motor.service';
import { DevicesService } from '../devices/devices.service';
import { RedisService } from '../../database/services/redis.service';

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

  constructor(
    private motorService: MotorService,
    @Inject(forwardRef(() => DevicesService)) private devicesService: DevicesService,
    private redisService: RedisService,
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

  async emitSystemDataUpdate(deviceId: string) {
    try {
      const systemData = await this.fetchSystemData(deviceId);
      this.server.to(`system_data_${deviceId}`).emit('system_data', systemData);
      this.logger.log(`System data update emitted for device ${deviceId}`);
    } catch (error) {
      this.logger.error(`Failed to emit system data update for device ${deviceId}: ${error.message}`);
    }
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
                motor_state: {
          device_id: motorState.deviceId,
          motor_running: motorState.motorRunning,
          control_mode: motorState.controlMode,
          target_mode_active: motorState.targetModeActive,
          current_target_level: motorState.currentTargetLevel,
          target_description: motorState.targetDescription,
          protection_active: motorState.protectionActive,
          current_amps: motorState.currentAmps,
          power_watts: motorState.powerWatts,
          runtime_minutes: motorState.runtimeMinutes,
          total_runtime_hours: motorState.totalRuntimeHours,
          mcu_online: motorState.mcuOnline,
          last_command_source: motorState.lastCommandSource,
          last_command_reason: motorState.lastCommandReason,
          created_at: motorState.createdAt ? motorState.createdAt.toISOString() : new Date().toISOString(),
          updated_at: motorState.updatedAt ? motorState.updatedAt.toISOString() : new Date().toISOString(),
          last_heartbeat: motorState.lastHeartbeat ? motorState.lastHeartbeat.toISOString() : undefined,
          // Pending states
          pending_motor_running: motorState.pendingMotorRunning,
          pending_control_mode: motorState.pendingControlMode,
          pending_target_active: motorState.pendingTargetActive,
          pending_target_level: motorState.pendingTargetLevel,
          pending_command_id: motorState.pendingCommandId,
          pending_command_timestamp: motorState.pendingCommandTimestamp ? motorState.pendingCommandTimestamp.toISOString() : undefined,
        },
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