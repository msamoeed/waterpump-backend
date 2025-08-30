import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WALHealthEvent } from '../../database/services/wal-manager.service';

@Injectable()
export class WALManagementListener {
  private readonly logger = new Logger(WALManagementListener.name);

  @OnEvent('wal.health')
  handleWALHealth(event: WALHealthEvent) {
    this.logger.log(`WAL Health Event: ${event.action} - ${event.message}`);
    
    // You can add notifications here (email, Slack, etc.)
    if (event.stats.healthStatus === 'critical') {
      this.sendAlert('CRITICAL WAL Status', event);
    }
  }

  @OnEvent('wal.checkpoint')
  handleWALCheckpoint(event: any) {
    this.logger.log(`WAL Checkpoint Event: ${event.reason} - ${event.message}`);
  }

  @OnEvent('wal.restart_consideration')
  handleRestartConsideration(event: any) {
    this.logger.warn(`WAL Restart Consideration: ${event.reason}`);
    this.sendAlert('WAL Restart Consideration', event);
  }

  private sendAlert(title: string, event: any) {
    // Implement your alert mechanism here
    // Email, Slack, SMS, etc.
    this.logger.warn(`ALERT: ${title} - ${JSON.stringify(event)}`);
  }
}
