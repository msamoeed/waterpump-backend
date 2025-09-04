import { Controller, Get, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { MotorService } from './motor.service';
import { MotorControlCommandDto, MotorHeartbeatDto } from '../../common/dto/motor-control.dto';

@Controller('motor')
export class MotorController {
  constructor(private readonly motorService: MotorService) {}

  /**
   * Get current motor state (single source of truth)
   * Used by: Mobile app, MCU, Dashboard
   */
  @Get('state/:deviceId')
  async getMotorState(@Param('deviceId') deviceId: string) {
    try {
      const state = await this.motorService.getMotorState(deviceId);
      return {
        success: true,
        data: state,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        'Failed to get motor state',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get all motor states (for dashboard/monitoring)
   */
  @Get('states')
  async getAllMotorStates() {
    try {
      const states = await this.motorService.getAllMotorStates();
      return {
        success: true,
        data: states,
        count: states.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        'Failed to get motor states',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Send motor control command
   * Used by: Mobile app, API clients
   */
  @Post('control')
  async sendMotorCommand(@Body() command: MotorControlCommandDto) {
    try {
      const result = await this.motorService.processMotorCommand(command);
      return {
        success: true,
        message: 'Motor command processed successfully',
        data: result.state,
        command: command,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to process motor command',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get pending command for MCU
   * Used by: MCU polling for commands
   */
  @Get('command/:deviceId')
  async getPendingCommand(@Param('deviceId') deviceId: string) {
    try {
      const command = await this.motorService.getPendingCommand(deviceId);
      return command || { message: 'No pending commands' };
    } catch (error) {
      throw new HttpException(
        'Failed to get pending command',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * MCU heartbeat and state sync
   * Used by: MCU to report current state
   */
  @Post('heartbeat')
  async motorHeartbeat(@Body() heartbeat: MotorHeartbeatDto) {
    try {
      const state = await this.motorService.handleHeartbeat(heartbeat);
      return {
        success: true,
        message: 'Heartbeat processed successfully',
        data: state,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        'Failed to process heartbeat',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Acknowledge command execution
   * Used by: MCU to confirm command execution
   */
  @Post('command/:deviceId/acknowledge')
  async acknowledgeCommand(
    @Param('deviceId') deviceId: string,
    @Body() ackData: { command_id: string; success: boolean; error_message?: string }
  ) {
    try {
      await this.motorService.acknowledgeCommand(deviceId, ackData.command_id, ackData.success);
      return {
        success: true,
        message: 'Command acknowledgment processed',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        'Failed to process command acknowledgment',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Health check endpoint for motor system
   */
  @Get('health')
  async getMotorSystemHealth() {
    try {
      const states = await this.motorService.getAllMotorStates();
      const onlineDevices = states.filter(state => state.mcuOnline);
      const protectedDevices = states.filter(state => state.protectionActive);
      const runningDevices = states.filter(state => state.motorRunning);

      return {
        success: true,
        data: {
          total_devices: states.length,
          online_devices: onlineDevices.length,
          offline_devices: states.length - onlineDevices.length,
          running_motors: runningDevices.length,
          protected_motors: protectedDevices.length,
          system_healthy: protectedDevices.length === 0 && onlineDevices.length === states.length,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        'Failed to get motor system health',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('clear-pending-states/:deviceId')
  async clearPendingStates(@Param('deviceId') deviceId: string) {
    try {
      const updatedState = await this.motorService.clearPendingStates(deviceId);
      
      return {
        success: true,
        message: 'Pending states cleared successfully',
        state: updatedState,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        `Failed to clear pending states: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
