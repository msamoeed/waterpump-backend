import { Injectable, OnModuleInit } from '@nestjs/common';
import { MotorService } from './motor.service';

@Injectable()
export class MotorTasksService implements OnModuleInit {
  private offlineCheckInterval: NodeJS.Timeout;
  private statusLogInterval: NodeJS.Timeout;

  constructor(private readonly motorService: MotorService) {}

  onModuleInit() {
    // Check for offline MCUs every minute
    this.offlineCheckInterval = setInterval(async () => {
      try {
        await this.motorService.checkOfflineDevices();
      } catch (error) {
        console.error('Error checking offline devices:', error);
      }
    }, 60000); // 1 minute

    // Log motor system status every 5 minutes
    this.statusLogInterval = setInterval(async () => {
      try {
        const states = await this.motorService.getAllMotorStates();
        const onlineCount = states.filter(state => state.mcuOnline).length;
        const runningCount = states.filter(state => state.motorRunning).length;
        const protectedCount = states.filter(state => state.protectionActive).length;

        console.log(`[MOTOR SYSTEM] Devices: ${states.length}, Online: ${onlineCount}, Running: ${runningCount}, Protected: ${protectedCount}`);
      } catch (error) {
        console.error('Error logging system status:', error);
      }
    }, 300000); // 5 minutes
  }

  onModuleDestroy() {
    if (this.offlineCheckInterval) {
      clearInterval(this.offlineCheckInterval);
    }
    if (this.statusLogInterval) {
      clearInterval(this.statusLogInterval);
    }
  }
}
