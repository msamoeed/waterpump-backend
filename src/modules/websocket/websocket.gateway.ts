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
  WaterSupplyNotificationEvent,
  SensorStatusNotificationEvent,
} from '../../common/interfaces/websocket-events.interface';
import { MotorService } from '../motor/motor.service';
import { DevicesService } from '../devices/devices.service';
import { RedisService } from '../../database/services/redis.service';
import { OneSignalService } from '../../common/services/onesignal.service';
import { SensorMonitorService } from '../motor/sensor-monitor.service';
import { SensorMonitorEvents } from '../../common/interfaces/sensor-monitor-events.interface';

@Injectable()
@NestWebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
  allowEIO3: true, // Support ESP32 Socket.io v3 client
})
export class WebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect, SensorMonitorEvents {
  @WebSocketServer()
  server: Server<ClientToServerEvents, ServerToClientEvents>;

  private logger = new Logger('WebSocketGateway');

  // Mobile/web clients subscribed to a device
  private connectedClients: Map<string, Set<string>> = new Map();

  // ESP32 MCU sockets — one per device
  private espSockets: Map<string, Socket> = new Map();

  // OTA session data (device-level)
  private otaUpdateSessions: Map<string, any> = new Map();

  // Previous states for change-detection notifications
  private waterSupplyStates: Map<string, { ground: boolean; roof: boolean; system: boolean }> = new Map();
  private sensorConnectionStates: Map<string, { ground: { connected: boolean; working: boolean }; roof: { connected: boolean; working: boolean } }> = new Map();

  constructor(
    @Inject(forwardRef(() => MotorService)) private motorService: MotorService,
    @Inject(forwardRef(() => DevicesService)) private devicesService: DevicesService,
    @Inject(forwardRef(() => SensorMonitorService)) private sensorMonitorService: SensorMonitorService,
    private redisService: RedisService,
    private oneSignalService: OneSignalService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Connection lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  handleConnection(client: Socket) {
    const deviceId = client.handshake.query.device_id as string;
    const clientType = client.handshake.query.type as string;

    if (deviceId && clientType === 'mcu') {
      this.espSockets.set(deviceId, client);
      this.logger.log(`ESP32 MCU connected: ${deviceId} (socket: ${client.id})`);
    } else {
      this.logger.log(`Client connected: ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    // Remove from ESP32 map if it was an MCU socket
    for (const [deviceId, socket] of this.espSockets.entries()) {
      if (socket.id === client.id) {
        this.espSockets.delete(deviceId);
        this.logger.log(`ESP32 MCU disconnected: ${deviceId}`);
        // Mark device offline in Redis immediately
        this.motorService.markDeviceOffline(deviceId).catch(() => {});
        break;
      }
    }

    // Remove from mobile subscriber map
    for (const [deviceId, clients] of this.connectedClients.entries()) {
      if (clients.has(client.id)) {
        clients.delete(client.id);
        if (clients.size === 0) this.connectedClients.delete(deviceId);
        break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ESP32 MCU events (received from hardware)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * ESP32 registers itself after connecting.
   * Payload: { device_id: string }
   */
  @SubscribeMessage('register_mcu')
  async handleRegisterMcu(client: Socket, data: { device_id: string }) {
    const deviceId = data.device_id;
    this.espSockets.set(deviceId, client);
    client.join(`device_${deviceId}`);
    this.logger.log(`ESP32 MCU registered: ${deviceId}`);

    // Send latest Redis state so ESP32 can sync on reconnect
    const motorState = await this.motorService.getMotorState(deviceId);
    if (motorState) {
      client.emit('motor_state_sync', {
        device_id: deviceId,
        motor_running: motorState.motorRunning,
        control_mode: motorState.controlMode,
        target_mode_active: motorState.targetModeActive,
        current_target_level: motorState.currentTargetLevel,
        target_description: motorState.targetDescription,
        protection_active: motorState.protectionActive,
        buzzer_muted: motorState.buzzerMuted,
      });
    }

    // Check for a queued command in Redis (sent while MCU was offline)
    const pending = await this.motorService.getPendingCommand(deviceId);
    if (pending) {
      client.emit('motor_command', pending);
      this.logger.log(`Replayed queued command to reconnected ESP32: ${deviceId}`);
    }
  }

  /**
   * ESP32 sends full device status (replaces 15s HTTP POST).
   * Called on state change and periodically as a safety net.
   */
  @SubscribeMessage('device_status')
  async handleDeviceStatus(client: Socket, data: any) {
    const deviceId = data.device_id;
    if (!deviceId) return;

    try {
      await this.devicesService.updateDeviceStatus(data);
      // Sensor check is now triggered inside emitDeviceUpdate → no separate call needed
    } catch (error) {
      this.logger.error(`Failed to process device_status from ESP32 ${deviceId}: ${error.message}`);
    }
  }

  /**
   * ESP32 sends lightweight keepalive heartbeat (replaces 8s HTTP POST).
   * Contains minimal motor state so backend stays in sync.
   */
  @SubscribeMessage('device_heartbeat')
  async handleDeviceHeartbeat(client: Socket, data: any) {
    const deviceId = data.device_id;
    if (!deviceId) return;

    try {
      await this.motorService.handleHeartbeat(data);
      // Emit updated system data to mobile clients
      this.emitSystemDataUpdate(deviceId);
    } catch (error) {
      this.logger.error(`Failed to process heartbeat from ESP32 ${deviceId}: ${error.message}`);
    }
  }

  /**
   * ESP32 acknowledges a motor command execution.
   * Clears the pending state immediately (was 8s wait before).
   */
  @SubscribeMessage('command_ack')
  async handleCommandAck(client: Socket, data: { device_id: string; command_id: string; success: boolean; error_message?: string }) {
    const { device_id: deviceId, command_id: commandId, success } = data;
    this.logger.log(`Command ack from ESP32 ${deviceId}: ${commandId} → ${success ? 'OK' : 'FAIL'}`);

    await this.motorService.acknowledgeCommand(deviceId, commandId, success);

    // Emit immediately — mobile sees result in ~100ms instead of waiting for next heartbeat
    this.emitSystemDataUpdate(deviceId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mobile / web client events
  // ─────────────────────────────────────────────────────────────────────────────

  @SubscribeMessage('subscribe_device')
  handleSubscribeDevice(client: Socket, deviceId: string) {
    client.join(`device_${deviceId}`);
    if (!this.connectedClients.has(deviceId)) {
      this.connectedClients.set(deviceId, new Set());
    }
    this.connectedClients.get(deviceId)!.add(client.id);
    this.logger.log(`Client ${client.id} subscribed to device ${deviceId}`);
    // Send current status on subscribe
    this.handleGetSystemData(client, deviceId);
  }

  @SubscribeMessage('subscribe_system_data')
  async handleSubscribeSystemData(client: Socket, deviceId: string) {
    client.join(`system_data_${deviceId}`);
    this.logger.log(`Client ${client.id} subscribed to system data for ${deviceId}`);
    await this.handleGetSystemData(client, deviceId);
  }

  @SubscribeMessage('get_system_data')
  async handleGetSystemData(client: Socket, deviceId: string) {
    try {
      const systemData = await this.fetchSystemData(deviceId);
      client.emit('system_data', systemData);
    } catch (error) {
      this.logger.error(`Failed to fetch system data for ${deviceId}: ${error.message}`);
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
  async handleMotorControl(client: Socket, data: {
    device_id: string;
    action: 'start' | 'stop' | 'target' | 'auto' | 'manual' | 'reset_protection' | 'enable_buzzer' | 'disable_buzzer';
    reason?: string;
    target_level?: number;
  }) {
    const deviceId = data.device_id;
    this.logger.log(`Motor control from mobile — device: ${deviceId}, action: ${data.action}`);

    try {
      const result = await this.motorService.processMotorCommand({
        action: data.action,
        reason: data.reason || `${data.action} from mobile app`,
        device_id: deviceId,
        source: 'mobile',
        target_level: data.target_level,
      });

      client.emit('motor_control_response', {
        device_id: deviceId,
        success: result.success,
        action: data.action,
        message: result.success ? `Motor ${data.action} command sent` : result.conflictResolution?.reason || 'Command failed',
        motor_state: result.state,
        timestamp: new Date().toISOString(),
        target_level: data.target_level,
        conflict_resolution: result.conflictResolution,
      });

      if (!result.success) return;

      // Push command directly to ESP32 over WebSocket if it is connected
      const espSocket = this.espSockets.get(deviceId);
      if (espSocket?.connected) {
        const mcuCommand = await this.motorService.getPendingCommand(deviceId);
        if (mcuCommand) {
          espSocket.emit('motor_command', mcuCommand);
          this.logger.log(`Motor command pushed directly to ESP32 ${deviceId} via WebSocket`);
        }
      } else {
        // Command stays in Redis queue — ESP32 will poll it via HTTP fallback
        this.logger.log(`ESP32 ${deviceId} not connected via WS — command queued in Redis`);
      }

      this.emitSystemDataUpdate(deviceId);
    } catch (error) {
      this.logger.error(`Motor control error for ${deviceId}: ${error.message}`);
      client.emit('motor_control_response', {
        device_id: deviceId,
        success: false,
        action: data.action,
        message: error.message,
        timestamp: new Date().toISOString(),
        conflict_resolution: { type: 'error', reason: error.message, suggestedAction: 'Check device status and try again' },
      });
    }
  }

  @SubscribeMessage('clear_pending_states')
  async handleClearPendingStates(client: Socket, data: { device_id: string; reason?: string }) {
    try {
      const updatedState = await this.motorService.clearPendingStates(data.device_id);
      client.emit('clear_pending_states_response', {
        device_id: data.device_id,
        success: true,
        message: 'Pending states cleared',
        reason: data.reason || 'Cleared from mobile app',
        motor_state: updatedState,
        timestamp: new Date().toISOString(),
      });
      this.emitSystemDataUpdate(data.device_id);
    } catch (error) {
      client.emit('clear_pending_states_response', {
        device_id: data.device_id,
        success: false,
        message: error.message,
        reason: data.reason || '',
        timestamp: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('reset_protection')
  async handleResetProtection(client: Socket, data: { device_id: string; reason?: string }) {
    try {
      const motorState = await this.motorService.getMotorState(data.device_id);

      if (!motorState) {
        return client.emit('protection_reset_response', {
          success: false, error: 'Device not found', device_id: data.device_id, timestamp: new Date().toISOString(),
        });
      }
      if (!motorState.protectionActive) {
        return client.emit('protection_reset_response', {
          success: false, error: 'Protection is not currently active', device_id: data.device_id, timestamp: new Date().toISOString(),
        });
      }

      const result = await this.motorService.processMotorCommand({
        action: 'reset_protection',
        reason: data.reason || 'Manual protection reset from mobile app',
        device_id: data.device_id,
        source: 'mobile',
      });

      client.emit('protection_reset_response', {
        success: result.success,
        message: result.success ? 'Protection reset command sent' : 'Failed to reset protection',
        device_id: data.device_id,
        reason: data.reason,
        timestamp: new Date().toISOString(),
      });

      if (result.success) {
        // Push immediately to ESP32
        const espSocket = this.espSockets.get(data.device_id);
        if (espSocket?.connected) {
          const mcuCommand = await this.motorService.getPendingCommand(data.device_id);
          if (mcuCommand) espSocket.emit('motor_command', mcuCommand);
        }
        this.emitSystemDataUpdate(data.device_id);
      }
    } catch (error) {
      client.emit('protection_reset_response', {
        success: false, error: error.message, device_id: data.device_id, timestamp: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('get_sensor_status')
  async handleGetSensorStatus(client: Socket, deviceId: string) {
    try {
      const pauseStatus = await this.sensorMonitorService.getSensorPauseStatus(deviceId);
      const isOverridden = await this.sensorMonitorService.isSensorMonitoringOverridden(deviceId);
      client.emit('sensor_status_response', {
        success: true,
        data: { device_id: deviceId, sensor_monitoring_active: !isOverridden, is_overridden: isOverridden, pause_status: pauseStatus, timestamp: new Date().toISOString() },
        device_id: deviceId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      client.emit('sensor_status_response', { success: false, error: error.message, device_id: deviceId, timestamp: new Date().toISOString() });
    }
  }

  @SubscribeMessage('override_sensor_monitoring')
  async handleOverrideSensorMonitoring(client: Socket, data: { device_id: string; enable: boolean; reason?: string }) {
    try {
      await this.sensorMonitorService.overrideSensorMonitoring(data.device_id, data.enable, data.reason);
      client.emit('sensor_override_response', {
        success: true,
        message: `Sensor monitoring ${data.enable ? 'overridden' : 'enabled'}`,
        data: { device_id: data.device_id, override_enabled: data.enable, reason: data.reason, timestamp: new Date().toISOString() },
        device_id: data.device_id,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      client.emit('sensor_override_response', { success: false, error: error.message, device_id: data.device_id, timestamp: new Date().toISOString() });
    }
  }

  @SubscribeMessage('force_sensor_check')
  async handleForceSensorCheck(client: Socket, deviceId: string) {
    try {
      await this.sensorMonitorService.processDeviceSensors(deviceId);
      client.emit('sensor_check_response', {
        success: true, message: 'Sensor check completed', data: { device_id: deviceId, timestamp: new Date().toISOString() }, device_id: deviceId, timestamp: new Date().toISOString(),
      });
    } catch (error) {
      client.emit('sensor_check_response', { success: false, error: error.message, device_id: deviceId, timestamp: new Date().toISOString() });
    }
  }

  // OTA events
  @SubscribeMessage('request_ota_update')
  async handleRequestOTAUpdate(client: Socket, deviceId: string) {
    try {
      const latestRelease = await this.getLatestRelease();
      if (!latestRelease) {
        return client.emit('ota_update_response', { success: false, error: 'No firmware releases available', device_id: deviceId });
      }

      this.otaUpdateSessions.set(deviceId, { deviceId, release: latestRelease, status: 'initiated', startTime: new Date(), progress: 0 });

      // Push to ESP32 via WebSocket if connected, else via room broadcast
      const espSocket = this.espSockets.get(deviceId);
      const otaPayload: OTAUpdateEvent = {
        device_id: deviceId, version: latestRelease.version,
        download_url: latestRelease.firmware_url, manifest: latestRelease.manifest,
        timestamp: new Date().toISOString(),
      };
      if (espSocket?.connected) {
        espSocket.emit('ota_update_available', otaPayload);
      } else {
        this.server.to(`device_${deviceId}`).emit('ota_update_available', otaPayload);
      }

      client.emit('ota_update_response', { success: true, message: `OTA initiated for ${latestRelease.version}`, device_id: deviceId, version: latestRelease.version });
    } catch (error) {
      client.emit('ota_update_response', { success: false, error: error.message, device_id: deviceId });
    }
  }

  @SubscribeMessage('ota_progress')
  handleOTAProgress(client: Socket, data: { device_id: string; progress: number; status: string }) {
    const session = this.otaUpdateSessions.get(data.device_id);
    if (session) { session.progress = data.progress; session.status = data.status; }
    this.server.to(`device_${data.device_id}`).emit('ota_progress_update', { ...data, timestamp: new Date().toISOString() });
  }

  @SubscribeMessage('ota_complete')
  handleOTAComplete(client: Socket, data: { device_id: string; success: boolean; version: string; error?: string }) {
    this.otaUpdateSessions.delete(data.device_id);
    this.server.to(`device_${data.device_id}`).emit('ota_update_complete', { ...data, timestamp: new Date().toISOString() });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Emit helpers (called by other services)
  // ─────────────────────────────────────────────────────────────────────────────

  emitDeviceUpdate(deviceId: string, data: DeviceUpdateEvent) {
    this.server.to(`device_${deviceId}`).emit('device_update', data);
    // Trigger sensor check event-driven — no more 10s polling
    setImmediate(() => this.sensorMonitorService.processDeviceSensors(deviceId).catch(() => {}));
  }

  emitPumpEvent(data: PumpEvent) { this.server.emit('pump_event', data); }
  emitAlert(data: AlertEvent) { this.server.emit('alert_triggered', data); }
  emitDeviceOffline(data: DeviceOfflineEvent) { this.server.emit('device_offline', data); }
  emitOTAUpdate(deviceId: string, data: OTAUpdateEvent) { this.server.to(`device_${deviceId}`).emit('ota_update_available', data); }

  emitDeviceLog(deviceId: string, data: { level: string; message: string; timestamp?: string }) {
    this.server.to(`device_${deviceId}`).emit('device_log', {
      device_id: deviceId, level: (data.level || 'info') as any,
      message: data.message, timestamp: data.timestamp || new Date().toISOString(),
    });
  }

  // SensorMonitorEvents interface
  emitSensorStatusUpdate(deviceId: string, status: any): void { this.server.to(`device_${deviceId}`).emit('sensor_monitoring_update', status); }
  emitPumpPauseEvent(deviceId: string, data: any): void { this.server.to(`device_${deviceId}`).emit('pump_paused_sensor', data); }
  emitPumpResumeEvent(deviceId: string, data: any): void { this.server.to(`device_${deviceId}`).emit('pump_resumed_sensor', data); }
  emitDetailedPumpPauseEvent(deviceId: string, data: any): void { this.server.to(`device_${deviceId}`).emit('pump_pause_details', data); }
  emitSensorOverrideEvent(deviceId: string, data: any): void { this.server.to(`device_${deviceId}`).emit('sensor_override_update', data); }
  emitSystemAlert(data: any): void { this.server.emit('system_alert', data); }
  emitPumpPauseDetails(deviceId: string, data: any): void { this.server.to(`device_${deviceId}`).emit('pump_pause_details', data); }
  emitSensorMonitoringUpdate(deviceId: string, data: any): void { this.server.to(`device_${deviceId}`).emit('sensor_monitoring_update', data); }
  emitSensorOverrideUpdate(deviceId: string, data: any): void { this.server.to(`device_${deviceId}`).emit('sensor_override_update', data); }

  emitWaterSupplyNotification(deviceId: string, tankId: 'ground' | 'roof' | 'system', currentState: boolean, previousState: boolean, reason?: string) {
    const notification: WaterSupplyNotificationEvent = {
      device_id: deviceId, tank_id: tankId, water_supply_on: currentState,
      previous_state: previousState, timestamp: new Date().toISOString(), reason,
    };
    this.server.to(`device_${deviceId}`).emit('water_supply_notification', notification);
    this.oneSignalService.sendWaterSupplyNotification(deviceId, tankId, currentState, previousState);
  }

  emitSensorStatusNotification(deviceId: string, tankId: 'ground' | 'roof', connected: boolean, working: boolean, previousConnected: boolean, previousWorking: boolean, reason?: string) {
    const notification: SensorStatusNotificationEvent = {
      device_id: deviceId, tank_id: tankId,
      sensor_connected: connected, sensor_working: working,
      previous_connected: previousConnected, previous_working: previousWorking,
      timestamp: new Date().toISOString(), reason,
    };
    this.server.to(`device_${deviceId}`).emit('sensor_status_notification', notification);
    this.oneSignalService.sendSensorStatusNotification(deviceId, tankId, connected, working, previousConnected, previousWorking);
  }

  async emitSystemDataUpdate(deviceId: string) {
    try {
      const systemData = await this.fetchSystemData(deviceId);
      this.server.to(`system_data_${deviceId}`).emit('system_data', systemData);
      this.checkAndEmitNotifications(deviceId, systemData);
    } catch (error) {
      this.logger.error(`Failed to emit system data update for ${deviceId}: ${error.message}`);
    }
  }

  // ───────────────────────────────────────────────────��─────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────────

  isEspConnected(deviceId: string): boolean {
    return this.espSockets.get(deviceId)?.connected ?? false;
  }

  getConnectedClientsCount(deviceId?: string): number {
    if (deviceId) return this.connectedClients.get(deviceId)?.size || 0;
    return this.server.engine.clientsCount;
  }

  getSubscribedDevices(): string[] { return Array.from(this.connectedClients.keys()); }
  getOTASessions(): any[] { return Array.from(this.otaUpdateSessions.values()); }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private async fetchSystemData(deviceId: string): Promise<SystemDataEvent> {
    const [motorState, deviceStatus, alertsData] = await Promise.all([
      this.motorService.getMotorState(deviceId),
      this.devicesService.getCurrentStatus(deviceId),
      this.redisService.getActiveAlerts(deviceId),
    ]);

    const alerts = Object.entries(alertsData).map(([id, alertStr]) => {
      try {
        const a = JSON.parse(alertStr as string);
        return { id, type: a.type || 'unknown', message: a.message || '', severity: a.severity || 'medium', created_at: a.created_at || new Date().toISOString(), expires_at: a.expires_at };
      } catch {
        return { id, type: 'parse_error', message: 'Failed to parse alert', severity: 'low' as const, created_at: new Date().toISOString() };
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
        pendingMotorRunning: motorState.pendingMotorRunning,
        pendingControlMode: motorState.pendingControlMode,
        pendingTargetActive: motorState.pendingTargetActive,
        pendingTargetLevel: motorState.pendingTargetLevel,
        pendingCommandId: motorState.pendingCommandId,
        pendingCommandTimestamp: motorState.pendingCommandTimestamp instanceof Date
          ? motorState.pendingCommandTimestamp.toISOString()
          : motorState.pendingCommandTimestamp,
      } : null,
      device_status: deviceStatus,
      alerts,
      timestamp: new Date().toISOString(),
    };
  }

  private checkAndEmitNotifications(deviceId: string, systemData: SystemDataEvent) {
    this.checkWaterSupplyChanges(deviceId, systemData);
    this.checkSensorStatusChanges(deviceId, systemData);
  }

  private checkWaterSupplyChanges(deviceId: string, systemData: SystemDataEvent) {
    const cur = {
      ground: systemData.device_status?.ground_tank?.water_supply_on || false,
      roof: systemData.device_status?.roof_tank?.water_supply_on || false,
      system: systemData.device_status?.system?.water_supply_active || false,
    };
    const prev = this.waterSupplyStates.get(deviceId) || { ground: false, roof: false, system: false };

    if (cur.ground !== prev.ground) this.emitWaterSupplyNotification(deviceId, 'ground', cur.ground, prev.ground);
    if (cur.roof !== prev.roof) this.emitWaterSupplyNotification(deviceId, 'roof', cur.roof, prev.roof);
    if (cur.system !== prev.system) this.emitWaterSupplyNotification(deviceId, 'system', cur.system, prev.system);

    this.waterSupplyStates.set(deviceId, cur);
  }

  private checkSensorStatusChanges(deviceId: string, systemData: SystemDataEvent) {
    const curGround = {
      connected: systemData.device_status?.ground_tank?.connected || false,
      working: systemData.device_status?.ground_tank?.sensor_working || false,
    };
    const curRoof = {
      connected: systemData.device_status?.roof_tank?.connected || false,
      working: systemData.device_status?.roof_tank?.sensor_working || false,
    };
    const prev = this.sensorConnectionStates.get(deviceId) || {
      ground: { connected: false, working: false }, roof: { connected: false, working: false },
    };

    if (curGround.connected !== prev.ground.connected || curGround.working !== prev.ground.working) {
      this.emitSensorStatusNotification(deviceId, 'ground', curGround.connected, curGround.working, prev.ground.connected, prev.ground.working);
    }
    if (curRoof.connected !== prev.roof.connected || curRoof.working !== prev.roof.working) {
      this.emitSensorStatusNotification(deviceId, 'roof', curRoof.connected, curRoof.working, prev.roof.connected, prev.roof.working);
    }

    this.sensorConnectionStates.set(deviceId, { ground: curGround, roof: curRoof });
  }

  private async getLatestRelease(): Promise<any> {
    try {
      const response = await fetch('https://api.github.com/repos/msamoeed/waterpump-mcu/releases/latest');
      const release = await response.json();
      const firmwareAsset = release.assets.find((a: any) => a.name === 'firmware.bin');
      const manifestAsset = release.assets.find((a: any) => a.name === 'manifest.json');
      if (!firmwareAsset) throw new Error('firmware.bin not found in latest release');
      let manifest = null;
      if (manifestAsset) {
        const r = await fetch(manifestAsset.browser_download_url);
        manifest = await r.json();
      }
      return { version: release.tag_name, firmware_url: firmwareAsset.browser_download_url, manifest, release_date: release.published_at, description: release.body };
    } catch (error) {
      this.logger.error(`Failed to get latest release: ${error.message}`);
      return null;
    }
  }
}
