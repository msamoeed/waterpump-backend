import { Module } from '@nestjs/common';
import { WALManagementController } from './wal-management.controller';
import { WALManagerService } from '../../database/services/wal-manager.service';
import { WALManagementListener } from './wal-management.listener';
import { InfluxService } from '../../database/services/influx.service';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [WALManagementController],
  providers: [WALManagerService, WALManagementListener, InfluxService],
  exports: [WALManagerService]
})
export class WALManagementModule {}
