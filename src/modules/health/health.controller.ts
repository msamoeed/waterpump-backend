import { Controller, Get, Inject } from '@nestjs/common';
import { HealthService } from './health.service';
import { InfluxService } from '../../database/services/influx.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    @Inject('INFLUXDB_SERVICE') private influxService: InfluxService,
  ) {}

  @Get()
  async getHealth() {
    return await this.healthService.checkHealth();
  }

  @Get('databases')
  async getDatabaseHealth() {
    return await this.healthService.checkDatabaseHealth();
  }

  @Get('debug/influxdb')
  async debugInfluxDB() {
    try {
      const bucket = process.env.INFLUXDB_BUCKET || 'waterpump';
      const org = process.env.INFLUXDB_ORG || 'your-org';
      const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
      
      console.log('[DEBUG] InfluxDB Config:', { bucket, org, url });
      
      // Test basic query
      const testData = await this.influxService.queryHistoricalData(
        'esp32_controller_001',
        'water_levels',
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
      );
      
      return {
        config: { bucket, org, url },
        testQuery: {
          deviceId: 'esp32_controller_001',
          measurement: 'water_levels',
          recordsFound: testData.length,
          sampleData: testData.slice(0, 3)
        }
      };
    } catch (error) {
      console.error('[DEBUG] InfluxDB Debug Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }
} 