import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { InfluxService } from '../../database/services/influx.service';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: 'INFLUXDB_SERVICE',
      useExisting: InfluxService,
    },
    {
      provide: 'REDIS_SERVICE',
      useExisting: RedisService,
    },
    {
      provide: 'POSTGRES_SERVICE',
      useExisting: PostgresService,
    },
  ],
  exports: [HealthService],
})
export class HealthModule {} 