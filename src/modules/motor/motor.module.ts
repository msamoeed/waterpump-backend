import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MotorController } from './motor.controller';
import { MotorService } from './motor.service';
import { MotorTasksService } from './motor-tasks.service';
import { MotorState } from '../../database/entities/motor-state.entity';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MotorState]),
    DatabaseModule,
  ],
  controllers: [MotorController],
  providers: [MotorService, MotorTasksService],
  exports: [MotorService],
})
export class MotorModule {}
