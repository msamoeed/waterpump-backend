import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DuckDBService } from '../../database/services/duckdb.service';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';

@Module({
  imports: [DatabaseModule, forwardRef(() => WebSocketModule)],
  controllers: [DevicesController],
  providers: [
    DevicesService,
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
  exports: [DevicesService],
})
export class DevicesModule {} 