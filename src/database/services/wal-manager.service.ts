import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InfluxService } from './influx.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface WALStats {
  fileCount: number;
  totalSizeGB: number;
  lastCheckpoint: Date;
  healthStatus: 'healthy' | 'warning' | 'critical';
  recommendations: string[];
}

export interface WALHealthEvent {
  timestamp: Date;
  stats: WALStats;
  action: string;
  success: boolean;
  message: string;
}

@Injectable()
export class WALManagerService {
  private readonly logger = new Logger(WALManagerService.name);
  private isProcessing = false;
  private lastCheckpoint: Date | null = null;
  private readonly MAX_WAL_FILES = 30;
  private readonly MAX_WAL_SIZE_GB = 1;
  private readonly CHECKPOINT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly influxService: InfluxService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Monitor WAL health every 2 minutes
  @Cron(CronExpression.EVERY_2_MINUTES)
  async monitorWALHealth() {
    if (this.isProcessing) {
      this.logger.debug('WAL management already in progress, skipping...');
      return;
    }

    try {
      this.isProcessing = true;
      await this.performWALHealthCheck();
    } catch (error) {
      this.logger.error('Failed to perform WAL health check', error);
    } finally {
      this.isProcessing = false;
    }
  }

  // Force checkpoint every 10 minutes if needed
  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledCheckpoint() {
    if (this.isProcessing) return;

    try {
      this.isProcessing = true;
      const stats = await this.getWALStats();
      
      if (this.shouldTriggerCheckpoint(stats)) {
        await this.triggerCheckpoint('scheduled');
      }
    } catch (error) {
      this.logger.error('Failed to perform scheduled checkpoint', error);
    } finally {
      this.isProcessing = false;
    }
  }

  // Main WAL health check
  private async performWALHealthCheck() {
    const stats = await this.getWALStats();
    const healthEvent: WALHealthEvent = {
      timestamp: new Date(),
      stats,
      action: 'health_check',
      success: true,
      message: 'WAL health check completed'
    };

    // Determine if intervention is needed
    if (stats.healthStatus === 'critical') {
      this.logger.warn(`🚨 CRITICAL WAL status: ${stats.fileCount} files, ${stats.totalSizeGB.toFixed(2)}GB`);
      await this.handleCriticalWAL(stats);
      healthEvent.action = 'critical_intervention';
    } else if (stats.healthStatus === 'warning') {
      this.logger.warn(`⚠️  WARNING WAL status: ${stats.fileCount} files, ${stats.totalSizeGB.toFixed(2)}GB`);
      await this.handleWarningWAL(stats);
      healthEvent.action = 'warning_intervention';
    } else {
      this.logger.debug(`✅ WAL health normal: ${stats.fileCount} files, ${stats.totalSizeGB.toFixed(2)}GB`);
    }

    // Emit health event
    this.eventEmitter.emit('wal.health', healthEvent);
  }

  // Get comprehensive WAL statistics
  async getWALStats(): Promise<WALStats> {
    try {
      // Get WAL file count and size
      const walInfo = await this.getWALFileInfo();
      
      // Determine health status
      const healthStatus = this.determineHealthStatus(walInfo.fileCount, walInfo.totalSizeGB);
      
      // Generate recommendations
      const recommendations = this.generateRecommendations(walInfo, healthStatus);
      
      return {
        fileCount: walInfo.fileCount,
        totalSizeGB: walInfo.totalSizeGB,
        lastCheckpoint: this.lastCheckpoint,
        healthStatus,
        recommendations
      };
    } catch (error) {
      this.logger.error('Failed to get WAL stats', error);
      return {
        fileCount: 0,
        totalSizeGB: 0,
        lastCheckpoint: this.lastCheckpoint,
        healthStatus: 'critical',
        recommendations: ['Unable to determine WAL status - check InfluxDB connectivity']
      };
    }
  }

  // Get WAL file information from InfluxDB
  private async getWALFileInfo(): Promise<{ fileCount: number; totalSizeGB: number }> {
    try {
      // Try to get WAL info from system tables
      const result = await this.influxService.executeQuery(`
        SELECT 
          COUNT(*) as file_count,
          COALESCE(SUM(size), 0) / (1024*1024*1024) as total_size_gb
        FROM system.wal_files
      `);

      if (result && result.length > 0) {
        return {
          fileCount: parseInt(result[0].file_count) || 0,
          totalSizeGB: parseFloat(result[0].total_size_gb) || 0
        };
      }
    } catch (error) {
      this.logger.debug('System table query failed, using fallback method');
    }

    // Fallback: estimate based on container inspection
    return await this.getWALInfoFallback();
  }

  // Fallback method to get WAL info
  private async getWALInfoFallback(): Promise<{ fileCount: number; totalSizeGB: number }> {
    try {
      // This would require Docker API access or exec commands
      // For now, return conservative estimates
      return {
        fileCount: 0, // Will be updated when we implement Docker integration
        totalSizeGB: 0
      };
    } catch (error) {
      this.logger.error('Failed to get WAL info fallback', error);
      return { fileCount: 0, totalSizeGB: 0 };
    }
  }

  // Determine health status based on thresholds
  private determineHealthStatus(fileCount: number, totalSizeGB: number): 'healthy' | 'warning' | 'critical' {
    if (fileCount > this.MAX_WAL_FILES * 2 || totalSizeGB > this.MAX_WAL_SIZE_GB * 3) {
      return 'critical';
    } else if (fileCount > this.MAX_WAL_FILES || totalSizeGB > this.MAX_WAL_SIZE_GB) {
      return 'warning';
    } else {
      return 'healthy';
    }
  }

  // Generate recommendations based on WAL status
  private generateRecommendations(walInfo: { fileCount: number; totalSizeGB: number }, healthStatus: string): string[] {
    const recommendations: string[] = [];

    if (healthStatus === 'critical') {
      recommendations.push('Immediate checkpoint required');
      recommendations.push('Consider container restart if checkpoint fails');
      recommendations.push('Review write patterns and batch size');
    } else if (healthStatus === 'warning') {
      recommendations.push('Schedule checkpoint soon');
      recommendations.push('Monitor WAL growth rate');
      recommendations.push('Optimize write batching');
    } else {
      recommendations.push('WAL health is optimal');
      recommendations.push('Continue current write patterns');
    }

    return recommendations;
  }

  // Handle critical WAL status
  private async handleCriticalWAL(stats: WALStats) {
    this.logger.warn('Handling critical WAL status...');
    
    // Force immediate checkpoint
    await this.triggerCheckpoint('critical');
    
    // If still critical after checkpoint, consider restart
    setTimeout(async () => {
      const newStats = await this.getWALStats();
      if (newStats.healthStatus === 'critical') {
        this.logger.error('WAL still critical after checkpoint, considering restart...');
        await this.considerContainerRestart();
      }
    }, 60000); // Wait 1 minute
  }

  // Handle warning WAL status
  private async handleWarningWAL(stats: WALStats) {
    this.logger.warn('Handling warning WAL status...');
    
    // Schedule checkpoint if cooldown has passed
    if (this.canTriggerCheckpoint()) {
      await this.triggerCheckpoint('warning');
    } else {
      this.logger.debug('Checkpoint cooldown active, skipping...');
    }
  }

  // Check if checkpoint should be triggered
  private shouldTriggerCheckpoint(stats: WALStats): boolean {
    if (stats.healthStatus === 'healthy') return false;
    if (!this.canTriggerCheckpoint()) return false;
    return true;
  }

  // Trigger checkpoint
  async triggerCheckpoint(reason: string = 'manual') {
    if (!this.canTriggerCheckpoint()) {
      const cooldownRemaining = this.getCheckpointCooldownRemaining();
      this.logger.warn(`Checkpoint cooldown active. ${cooldownRemaining}ms remaining`);
      return false;
    }

    try {
      this.logger.log(`🔄 Triggering checkpoint (reason: ${reason})...`);
      
      // Try to trigger checkpoint via InfluxDB
      await this.influxService.executeQuery('CHECKPOINT');
      
      this.lastCheckpoint = new Date();
      this.logger.log('✅ Checkpoint completed successfully');
      
      // Emit checkpoint event
      this.eventEmitter.emit('wal.checkpoint', {
        timestamp: new Date(),
        reason,
        success: true,
        message: 'Checkpoint completed successfully'
      });
      
      return true;
    } catch (error) {
      this.logger.error('❌ Checkpoint failed', error);
      
      // Emit checkpoint failure event
      this.eventEmitter.emit('wal.checkpoint', {
        timestamp: new Date(),
        reason,
        success: false,
        message: `Checkpoint failed: ${error.message}`
      });
      
      return false;
    }
  }

  // Check if checkpoint can be triggered
  private canTriggerCheckpoint(): boolean {
    if (!this.lastCheckpoint) return true;
    
    const timeSinceLastCheckpoint = Date.now() - this.lastCheckpoint.getTime();
    return timeSinceLastCheckpoint >= this.CHECKPOINT_COOLDOWN_MS;
  }

  // Get remaining cooldown time
  private getCheckpointCooldownRemaining(): number {
    if (!this.lastCheckpoint) return 0;
    
    const timeSinceLastCheckpoint = Date.now() - this.lastCheckpoint.getTime();
    const remaining = this.CHECKPOINT_COOLDOWN_MS - timeSinceLastCheckpoint;
    return Math.max(0, remaining);
  }

  // Consider container restart as last resort
  private async considerContainerRestart() {
    this.logger.warn('🚨 Considering container restart due to persistent WAL issues...');
    
    // Emit restart consideration event
    this.eventEmitter.emit('wal.restart_consideration', {
      timestamp: new Date(),
      reason: 'Persistent WAL issues after checkpoint',
      stats: await this.getWALStats()
    });
    
    // For now, just log. In production, you might want to implement actual restart logic
    // or integrate with your container orchestration system
  }

  // Manual WAL management endpoints
  async forceCheckpoint() {
    return await this.triggerCheckpoint('manual_force');
  }

  async getWALHealth() {
    return await this.getWALStats();
  }

  async getCheckpointStatus() {
    return {
      lastCheckpoint: this.lastCheckpoint,
      canTrigger: this.canTriggerCheckpoint(),
      cooldownRemaining: this.getCheckpointCooldownRemaining(),
      isProcessing: this.isProcessing
    };
  }
}
