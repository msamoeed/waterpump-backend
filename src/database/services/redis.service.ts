import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private client: Redis;

  constructor(private configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get('REDIS_HOST') || 'localhost',
      port: this.configService.get('REDIS_PORT') || 6379,
      password: this.configService.get('REDIS_PASSWORD'),
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
    } as any);

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
    });
  }

  async setDeviceStatus(deviceId: string, status: any, ttlSeconds: number): Promise<void> {
    const key = `device:${deviceId}:status`;
    await this.client.setex(key, ttlSeconds, JSON.stringify(status));
  }

  async getDeviceStatus(deviceId: string): Promise<string | null> {
    const key = `device:${deviceId}:status`;
    return await this.client.get(key);
  }

  // Motor State Operations (Redis as Primary Store)
  async setMotorState(deviceId: string, state: any, ttlSeconds: number = 7200): Promise<void> {
    const key = `motor_state:${deviceId}`;
    await this.client.setex(key, ttlSeconds, JSON.stringify(state)); // 2 hour TTL by default
  }

  async getMotorState(deviceId: string): Promise<string | null> {
    const key = `motor_state:${deviceId}`;
    return await this.client.get(key);
  }

  async updateMotorStateFields(deviceId: string, updates: Record<string, any>): Promise<void> {
    const key = `motor_state:${deviceId}`;
    const currentState = await this.client.get(key);
    
    if (currentState) {
      const state = JSON.parse(currentState);
      Object.assign(state, updates, { 
        updatedAt: new Date().toISOString(),
        lastUpdate: Date.now()
      });
      await this.client.setex(key, 7200, JSON.stringify(state)); // Refresh TTL
    }
  }

  async deleteMotorState(deviceId: string): Promise<void> {
    const key = `motor_state:${deviceId}`;
    await this.client.del(key);
  }

  // Motor Command Queue (for MCU polling)
  async setMotorCommand(deviceId: string, command: any, ttlSeconds: number = 120): Promise<void> {
    const key = `motor_command:${deviceId}`;
    await this.client.setex(key, ttlSeconds, JSON.stringify(command));
  }

  async getMotorCommand(deviceId: string): Promise<string | null> {
    const key = `motor_command:${deviceId}`;
    return await this.client.get(key);
  }

  async deleteMotorCommand(deviceId: string): Promise<void> {
    const key = `motor_command:${deviceId}`;
    await this.client.del(key);
  }

  async getDeviceKeys(): Promise<string[]> {
    return await this.client.keys('device:*:status');
  }

  async setActiveAlert(deviceId: string, alertId: string, alert: any): Promise<void> {
    const key = `alerts:active:${deviceId}`;
    await this.client.hset(key, alertId, JSON.stringify(alert));
    await this.client.expire(key, 3600); // 1 hour expiry
  }

  async getActiveAlerts(deviceId: string): Promise<Record<string, string>> {
    const key = `alerts:active:${deviceId}`;
    return await this.client.hgetall(key);
  }

  async clearAlert(deviceId: string, alertId: string): Promise<void> {
    const key = `alerts:active:${deviceId}`;
    await this.client.hdel(key, alertId);
  }

  async incrementPumpRuntime(deviceId: string, minutes: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const key = `pump:runtime:${deviceId}:${today}`;
    await this.client.incrby(key, minutes);
    await this.client.expire(key, 86400 * 30); // 30 days expiry
  }

  async getPumpRuntimeToday(deviceId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `pump:runtime:${deviceId}:${today}`;
    const runtime = await this.client.get(key);
    return runtime ? parseInt(runtime) : 0;
  }

  async cacheQuery(queryKey: string, data: any, ttlSeconds: number): Promise<void> {
    await this.client.setex(`cache:${queryKey}`, ttlSeconds, JSON.stringify(data));
  }

  async getCachedQuery(queryKey: string): Promise<any | null> {
    const cached = await this.client.get(`cache:${queryKey}`);
    return cached ? JSON.parse(cached) : null;
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  async ping(): Promise<string> {
    return await this.client.ping();
  }
} 