import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DevicesModule } from './modules/devices/devices.module';
import { DataModule } from './modules/data/data.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { WebSocketModule } from './modules/websocket/websocket.module';
import { HealthModule } from './modules/health/health.module';
import { MotorModule } from './modules/motor/motor.module';
import { WALManagementModule } from './modules/wal-management/wal-management.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    DevicesModule,
    DataModule,
    AlertsModule,
    WebSocketModule,
    HealthModule,
    MotorModule,
    WALManagementModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {} 