import { Injectable, Inject } from '@nestjs/common';
import { InfluxService } from '../../database/services/influx.service';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';

@Injectable()
export class HealthService {
  constructor(
    @Inject('INFLUXDB_SERVICE') private influxService: InfluxService,
    @Inject('REDIS_SERVICE') private redisService: RedisService,
    @Inject('POSTGRES_SERVICE') private postgresService: PostgresService,
  ) {}

  async checkHealth() {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    return {
      status: 'ok',
      timestamp,
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
      },
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  async checkDatabaseHealth() {
    const health = {
      timestamp: new Date().toISOString(),
      databases: {
        postgres: { status: 'unknown', error: null },
        redis: { status: 'unknown', error: null },
        influxdb: { status: 'unknown', error: null },
      },
    };

    // Check PostgreSQL
    try {
      await this.postgresService.getSystemStats();
      health.databases.postgres.status = 'ok';
    } catch (error) {
      health.databases.postgres.status = 'error';
      health.databases.postgres.error = error.message;
    }

    // Check Redis
    try {
      const ping = await this.redisService.ping();
      health.databases.redis.status = ping === 'PONG' ? 'ok' : 'error';
      if (ping !== 'PONG') {
        health.databases.redis.error = 'Unexpected ping response';
      }
    } catch (error) {
      health.databases.redis.status = 'error';
      health.databases.redis.error = error.message;
    }

    // Check InfluxDB
    try {
      // Try to get latest data as a health check
      await this.influxService.getLatestDeviceData('test');
      health.databases.influxdb.status = 'ok';
    } catch (error) {
      health.databases.influxdb.status = 'error';
      health.databases.influxdb.error = error.message;
    }

    // Overall status
    const allOk = Object.values(health.databases).every(db => db.status === 'ok');
    health['overall_status'] = allOk ? 'healthy' : 'degraded';

    return health;
  }

  async getHealth(): Promise<any> {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    };

    return health;
  }

  // Add performance monitoring
  async getPerformanceMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
        external: Math.round(memUsage.external / 1024 / 1024) + ' MB',
      },
      cpu: {
        user: Math.round(cpuUsage.user / 1000) + ' ms',
        system: Math.round(cpuUsage.system / 1000) + ' ms',
      },
      uptime: Math.round(process.uptime()) + ' seconds',
      platform: process.platform,
      nodeVersion: process.version,
    };
  }

  // Add system resource monitoring
  async getSystemResources() {
    try {
      const os = require('os');
      return {
        totalMemory: Math.round(os.totalmem() / 1024 / 1024) + ' MB',
        freeMemory: Math.round(os.freemem() / 1024 / 1024) + ' MB',
        cpuCount: os.cpus().length,
        loadAverage: os.loadavg(),
        uptime: Math.round(os.uptime()) + ' seconds',
      };
    } catch (error) {
      return { error: 'Unable to get system resources' };
    }
  }

  // Add cache status monitoring
  async getCacheStatus() {
    try {
      // Get cache statistics from DevicesService if available
      // For now, return basic cache info
      return {
        status: 'available',
        timestamp: new Date().toISOString(),
        note: 'Cache statistics available through DevicesService',
      };
    } catch (error) {
      return { error: 'Unable to get cache status' };
    }
  }
} 