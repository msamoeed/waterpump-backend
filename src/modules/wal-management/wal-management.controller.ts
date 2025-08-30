import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WALManagerService } from '../../database/services/wal-manager.service';

@ApiTags('WAL Management')
@Controller('wal-management')
export class WALManagementController {
  constructor(private readonly walManagerService: WALManagerService) {}

  @Get('health')
  @ApiOperation({ summary: 'Get WAL health status' })
  @ApiResponse({ status: 200, description: 'WAL health information' })
  async getWALHealth() {
    return await this.walManagerService.getWALHealth();
  }

  @Get('checkpoint-status')
  @ApiOperation({ summary: 'Get checkpoint status and cooldown information' })
  @ApiResponse({ status: 200, description: 'Checkpoint status' })
  async getCheckpointStatus() {
    return await this.walManagerService.getCheckpointStatus();
  }

  @Post('checkpoint')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force a checkpoint operation' })
  @ApiResponse({ status: 200, description: 'Checkpoint triggered successfully' })
  async forceCheckpoint() {
    const success = await this.walManagerService.forceCheckpoint();
    return {
      success,
      timestamp: new Date(),
      message: success ? 'Checkpoint triggered successfully' : 'Checkpoint failed or cooldown active'
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get detailed WAL statistics' })
  @ApiResponse({ status: 200, description: 'WAL statistics' })
  async getWALStats() {
    const stats = await this.walManagerService.getWALHealth();
    const checkpointStatus = await this.walManagerService.getCheckpointStatus();
    
    return {
      ...stats,
      checkpointStatus,
      systemInfo: {
        maxWALFiles: 30,
        maxWALSizeGB: 1,
        checkpointCooldownMs: 5 * 60 * 1000
      }
    };
  }
}
