import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MotorState } from '../../database/entities/motor-state.entity';
import { RedisService } from '../../database/services/redis.service';
import { PostgresService } from '../../database/services/postgres.service';
import { MotorControlCommandDto, MotorStateUpdateDto, MotorHeartbeatDto } from '../../common/dto/motor-control.dto';

@Injectable()
export class MotorService {
  constructor(
    @InjectRepository(MotorState)
    private motorStateRepository: Repository<MotorState>,
    private redisService: RedisService,
    private postgresService: PostgresService,
  ) {}

  /**
   * Get the current motor state for a device (Redis as single source of truth)
   */
  async getMotorState(deviceId: string): Promise<MotorState> {
    // Redis is primary - check first
    const redisState = await this.redisService.getMotorState(deviceId);
    if (redisState) {
      return JSON.parse(redisState);
    }

    // If not in Redis, check database as fallback for recovery
    let motorState = await this.motorStateRepository.findOne({
      where: { deviceId }
    });

    if (!motorState) {
      // Create default state for new devices
      motorState = await this.createDefaultMotorState(deviceId);
    }

    // IMPORTANT: Store in Redis as primary (longer TTL)
    await this.redisService.setMotorState(deviceId, motorState, 7200); // 2 hours

    console.log(`Motor state loaded from database and cached in Redis for device: ${deviceId}`);
    return motorState;
  }

  /**
   * Update motor state (Redis-first approach with PostgreSQL backup)
   */
  async updateMotorState(deviceId: string, updateData: Partial<MotorStateUpdateDto>): Promise<MotorState> {
    // Get current state from Redis (primary source)
    let motorState: MotorState;
    const redisState = await this.redisService.getMotorState(deviceId);
    
    if (redisState) {
      motorState = JSON.parse(redisState);
    } else {
      // Fallback to database if not in Redis
      motorState = await this.motorStateRepository.findOne({ where: { deviceId } });
      if (!motorState) {
        motorState = await this.createDefaultMotorState(deviceId);
      }
    }

    // Map snake_case DTO fields to camelCase entity fields
    const mappedUpdateData: Partial<MotorState> = {};
    
    if (updateData.motor_running !== undefined) mappedUpdateData.motorRunning = updateData.motor_running;
    if (updateData.control_mode !== undefined) mappedUpdateData.controlMode = updateData.control_mode as 'auto' | 'manual';
    if (updateData.target_mode_active !== undefined) mappedUpdateData.targetModeActive = updateData.target_mode_active;
    if (updateData.current_target_level !== undefined) mappedUpdateData.currentTargetLevel = updateData.current_target_level;
    if (updateData.target_description !== undefined) mappedUpdateData.targetDescription = updateData.target_description;
    if (updateData.protection_active !== undefined) mappedUpdateData.protectionActive = updateData.protection_active;
    if (updateData.current_amps !== undefined) mappedUpdateData.currentAmps = updateData.current_amps;
    if (updateData.power_watts !== undefined) mappedUpdateData.powerWatts = updateData.power_watts;
    if (updateData.runtime_minutes !== undefined) mappedUpdateData.runtimeMinutes = updateData.runtime_minutes;
    if (updateData.total_runtime_hours !== undefined) mappedUpdateData.totalRuntimeHours = updateData.total_runtime_hours;
    if (updateData.last_command_source !== undefined) mappedUpdateData.lastCommandSource = updateData.last_command_source;
    if (updateData.last_command_reason !== undefined) mappedUpdateData.lastCommandReason = updateData.last_command_reason;

    // Update fields with proper camelCase naming
    const updatedState = {
      ...motorState,
      ...mappedUpdateData,
      lastHeartbeat: new Date(),
      mcuOnline: true,
      updatedAt: new Date(),
      lastUpdate: Date.now(),
    };

    // PRIMARY: Update Redis immediately (single source of truth)
    await this.redisService.setMotorState(deviceId, updatedState, 7200); // 2 hours TTL

    // SECONDARY: Async backup to PostgreSQL (for history/recovery)
    setImmediate(async () => {
      try {
        await this.motorStateRepository.save(updatedState);
        console.log(`Motor state backed up to PostgreSQL for device: ${deviceId}`);
      } catch (error) {
        console.error(`Failed to backup motor state to PostgreSQL: ${error.message}`);
      }
    });

    // Log state change
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'motor_state_update',
      message: `Motor state updated: ${JSON.stringify(updateData)}`,
      severity: 'info',
    });

    console.log(`Motor state updated in Redis for device: ${deviceId}`);
    return updatedState as MotorState;
  }

  /**
   * Process motor control command (from mobile or API)
   */
  async processMotorCommand(command: MotorControlCommandDto): Promise<{ success: boolean; state: MotorState }> {
    const deviceId = command.device_id || 'esp32_controller_001';
    const currentState = await this.getMotorState(deviceId);

    // Validate command based on current state
    await this.validateCommand(command, currentState);

    // Create command for MCU to execute
    const mcuCommand = {
      action: command.action,
      target_level: command.target_level,
      reason: command.reason || 'API command',
      timestamp: new Date().toISOString(),
      command_id: `cmd_${Date.now()}`,
      source: command.source || 'api',
    };

    // Store command in Redis for MCU to pick up
    await this.redisService.setMotorCommand(deviceId, mcuCommand, 120); // 2 minutes TTL

    // Update expected state immediately for optimistic updates
    const expectedState = this.calculateExpectedState(currentState, command);
    const updatedState = await this.updateMotorState(deviceId, {
      ...expectedState,
      last_command_source: command.source || 'api',
      last_command_reason: command.reason || 'API command',
    });

    // Log command
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'motor_command',
      message: `Motor command: ${command.action} - ${command.reason || 'No reason'}`,
      severity: 'info',
    });

    return { success: true, state: updatedState };
  }

  /**
   * Handle MCU heartbeat
   */
  async handleHeartbeat(heartbeat: MotorHeartbeatDto): Promise<MotorState> {
    const updateData: Partial<MotorStateUpdateDto> = {
      motor_running: heartbeat.motor_running,
      control_mode: heartbeat.control_mode,
      target_mode_active: heartbeat.target_mode_active,
      current_target_level: heartbeat.current_target_level,
      target_description: heartbeat.target_description,
      protection_active: heartbeat.protection_active,
      current_amps: heartbeat.current_amps,
      power_watts: heartbeat.power_watts,
      runtime_minutes: heartbeat.runtime_minutes,
      total_runtime_hours: heartbeat.total_runtime_hours,
    };

    return await this.updateMotorState(heartbeat.device_id, updateData);
  }

  /**
   * Get pending command for MCU (Redis-based command queue)
   */
  async getPendingCommand(deviceId: string): Promise<any> {
    const commandData = await this.redisService.getMotorCommand(deviceId);
    
    if (commandData) {
      // Mark command as retrieved (don't delete yet, let MCU acknowledge)
      const command = JSON.parse(commandData);
      command.retrieved_at = new Date().toISOString();
      await this.redisService.setMotorCommand(deviceId, command, 60); // Reduce TTL to 1 minute
      console.log(`Command retrieved by MCU for device: ${deviceId}`, command);
      return command;
    }
    
    return null;
  }

  /**
   * Acknowledge command execution by MCU
   */
  async acknowledgeCommand(deviceId: string, commandId: string, success: boolean): Promise<void> {
    // Remove command from Redis queue
    await this.redisService.deleteMotorCommand(deviceId);

    // Log acknowledgment
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'motor_command_ack',
      message: `Command ${commandId} ${success ? 'executed successfully' : 'failed'}`,
      severity: success ? 'info' : 'warning',
    });

    console.log(`Command acknowledged and removed from queue: ${deviceId}/${commandId} - ${success ? 'SUCCESS' : 'FAILED'}`);
  }

  /**
   * Check for offline MCUs and mark them
   */
  async checkOfflineDevices(): Promise<void> {
    const offlineThreshold = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes

    await this.motorStateRepository
      .createQueryBuilder()
      .update(MotorState)
      .set({ mcuOnline: false })
      .where('last_heartbeat < :threshold OR last_heartbeat IS NULL', { threshold: offlineThreshold })
      .andWhere('mcu_online = :online', { online: true })
      .execute();
  }

  /**
   * Get all motor states (for dashboard/monitoring)
   */
  async getAllMotorStates(): Promise<MotorState[]> {
    return await this.motorStateRepository.find({
      order: { updatedAt: 'DESC' }
    });
  }

  private async createDefaultMotorState(deviceId: string): Promise<MotorState> {
    const defaultState = this.motorStateRepository.create({
      deviceId,
      motorRunning: false,
      controlMode: 'auto',
      targetModeActive: false,
      protectionActive: false,
      currentAmps: 0,
      powerWatts: 0,
      runtimeMinutes: 0,
      totalRuntimeHours: 0,
      mcuOnline: false,
    });

    return await this.motorStateRepository.save(defaultState);
  }

  private async validateCommand(command: MotorControlCommandDto, currentState: MotorState): Promise<void> {
    // Prevent starting motor if protection is active
    if (command.action === 'start' && currentState.protectionActive) {
      throw new BadRequestException('Cannot start motor: protection system is active');
    }

    // Validate target level
    if (command.action === 'target' && (!command.target_level || command.target_level <= 0)) {
      throw new BadRequestException('Target level must be specified and greater than 0');
    }

    // Check if MCU is online for critical commands
    if (['start', 'target'].includes(command.action) && !currentState.mcuOnline) {
      throw new BadRequestException('Cannot execute command: MCU is offline');
    }
  }

  private calculateExpectedState(currentState: MotorState, command: MotorControlCommandDto): Partial<MotorStateUpdateDto> {
    const expectedState: Partial<MotorStateUpdateDto> = {};

    switch (command.action) {
      case 'start':
        expectedState.motor_running = true;
        expectedState.target_mode_active = false;
        break;
      case 'stop':
        expectedState.motor_running = false;
        expectedState.target_mode_active = false;
        break;
      case 'target':
        expectedState.motor_running = true;
        expectedState.target_mode_active = true;
        expectedState.current_target_level = command.target_level;
        expectedState.target_description = `Target ${command.target_level}"`;
        break;
      case 'auto':
        expectedState.control_mode = 'auto';
        break;
      case 'manual':
        expectedState.control_mode = 'manual';
        break;
      case 'reset_protection':
        expectedState.protection_active = false;
        break;
    }

    return expectedState;
  }
}
