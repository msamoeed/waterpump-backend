import { Module, forwardRef } from '@nestjs/common';
import { WebSocketGateway } from './websocket.gateway';
import { MotorModule } from '../motor/motor.module';
import { DevicesModule } from '../devices/devices.module';
import { DatabaseModule } from '../../database/database.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [forwardRef(() => MotorModule), forwardRef(() => DevicesModule), DatabaseModule, CommonModule],
  providers: [WebSocketGateway],
  exports: [WebSocketGateway],
})
export class WebSocketModule {
  constructor(private readonly webSocketGateway: WebSocketGateway) {}
  
  getWebSocketGateway(): WebSocketGateway {
    return this.webSocketGateway;
  }
} 