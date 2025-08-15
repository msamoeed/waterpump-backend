import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MotorController } from './motor.controller';
import { MotorService } from './motor.service';
import { MotorTasksService } from './motor-tasks.service';
import { SensorMonitorService } from './sensor-monitor.service';
import { MotorState } from '../../database/entities/motor-state.entity';
import { DatabaseModule } from '../../database/database.module';
import { DevicesModule } from '../devices/devices.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { SensorMonitorEvents } from '../../common/interfaces/sensor-monitor-events.interface';
import { WebSocketGateway } from '../websocket/websocket.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([MotorState]),
    DatabaseModule,
    forwardRef(() => DevicesModule),
    forwardRef(() => WebSocketModule),
  ],
  controllers: [MotorController],
  providers: [
    MotorService, 
    MotorTasksService, 
    SensorMonitorService,
    {
      provide: 'SENSOR_MONITOR_EVENTS',
      useExisting: forwardRef(() => WebSocketGateway),
    },
  ],
  exports: [MotorService, SensorMonitorService],
})
export class MotorModule {}
