import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DuckDBService } from '../../database/services/duckdb.service';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: 'DUCKDB_SERVICE',
      useExisting: DuckDBService,
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