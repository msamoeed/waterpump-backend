import {
  WebSocketGateway as NestWebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  DeviceUpdateEvent,
  PumpEvent,
  AlertEvent,
  DeviceOfflineEvent,
} from '../../common/interfaces/websocket-events.interface';

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
} 