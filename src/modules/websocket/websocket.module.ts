import { Module } from '@nestjs/common';
import { WebSocketGateway } from './websocket.gateway';
import { MotorModule } from '../motor/motor.module';
import { DevicesModule } from '../devices/devices.module';
import { DatabaseModule } from '../../database/database.module';
 
@Module({
  imports: [MotorModule, DevicesModule, DatabaseModule],
  providers: [WebSocketGateway],
  exports: [WebSocketGateway],
})
export class WebSocketModule {} 