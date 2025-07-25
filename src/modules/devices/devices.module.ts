import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { InfluxService } from '../../database/services/influx.service';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';

@Module({
  imports: [DatabaseModule, WebSocketModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
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
  exports: [DevicesService],
})
export class DevicesModule {} 