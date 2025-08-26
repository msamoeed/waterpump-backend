import { Injectable, Inject } from '@nestjs/common';
import { DuckDBService } from '../../database/services/duckdb.service';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';

@Injectable()
export class HealthService {
  constructor(
    @Inject('DUCKDB_SERVICE') private duckdbService: DuckDBService,
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
        duckdb: { status: 'unknown', error: null },
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

    // Check DuckDB
    try {
      // Try to get latest data as a health check
      await this.duckdbService.getLatestDeviceData('test');
      health.databases.duckdb.status = 'ok';
    } catch (error) {
      health.databases.duckdb.status = 'error';
      health.databases.duckdb.error = error.message;
    }

    // Overall status
    const allOk = Object.values(health.databases).every(db => db.status === 'ok');
    health['overall_status'] = allOk ? 'healthy' : 'degraded';

    return health;
  }
} 