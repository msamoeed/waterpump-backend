import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DevicesModule } from './modules/devices/devices.module';
import { DataModule } from './modules/data/data.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { WebSocketModule } from './modules/websocket/websocket.module';
import { HealthModule } from './modules/health/health.module';
import { MotorModule } from './modules/motor/motor.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    DevicesModule,
    DataModule,
    AlertsModule,
    WebSocketModule,
    HealthModule,
    MotorModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {} 