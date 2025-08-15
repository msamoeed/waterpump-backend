import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MotorController } from './motor.controller';
import { MotorService } from './motor.service';
import { MotorTasksService } from './motor-tasks.service';
import { SensorMonitorService } from './sensor-monitor.service';
import { MotorState } from '../../database/entities/motor-state.entity';
import { DatabaseModule } from '../../database/database.module';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MotorState]),
    DatabaseModule,
    forwardRef(() => DevicesModule),
  ],
  controllers: [MotorController],
  providers: [MotorService, MotorTasksService, SensorMonitorService],
  exports: [MotorService, SensorMonitorService],
})
export class MotorModule {}
