import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MotorService } from './motor.service';

@Injectable()
export class MotorTasksService implements OnModuleInit, OnModuleDestroy {
  private offlineCheckInterval: NodeJS.Timeout;
  private stuckPendingInterval: NodeJS.Timeout;
  private statusLogInterval: NodeJS.Timeout;

  constructor(private readonly motorService: MotorService) {}

  onModuleInit() {
    // Check for offline MCUs every 30 seconds (Redis-based)
    this.offlineCheckInterval = setInterval(async () => {
      try {
        await this.motorService.checkOfflineDevices();
      } catch (error) {
        console.error('Error checking offline devices:', error);
      }
    }, 30000); // 30 seconds

    // Clear stuck pending states every 2 minutes (safety net for missed command_acks)
    this.stuckPendingInterval = setInterval(async () => {
      try {
        await this.motorService.clearAllStuckPendingStates();
      } catch (error) {
        console.error('Error clearing stuck pending states:', error);
      }
    }, 120000); // 2 minutes

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
    if (this.offlineCheckInterval) clearInterval(this.offlineCheckInterval);
    if (this.stuckPendingInterval) clearInterval(this.stuckPendingInterval);
    if (this.statusLogInterval) clearInterval(this.statusLogInterval);
  }
}
