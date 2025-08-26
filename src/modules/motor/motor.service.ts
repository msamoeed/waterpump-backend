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
    if (updateData.buzzer_muted !== undefined) mappedUpdateData.buzzerMuted = updateData.buzzer_muted;
    if (updateData.current_amps !== undefined) mappedUpdateData.currentAmps = updateData.current_amps;
    if (updateData.power_watts !== undefined) mappedUpdateData.powerWatts = updateData.power_watts;
    if (updateData.runtime_minutes !== undefined) mappedUpdateData.runtimeMinutes = updateData.runtime_minutes;
    if (updateData.total_runtime_hours !== undefined) mappedUpdateData.totalRuntimeHours = updateData.total_runtime_hours;
    if (updateData.last_command_source !== undefined) mappedUpdateData.lastCommandSource = updateData.last_command_source;
    if (updateData.last_command_reason !== undefined) mappedUpdateData.lastCommandReason = updateData.last_command_reason;
    
    // Map pending state fields
    if (updateData.pending_motor_running !== undefined) mappedUpdateData.pendingMotorRunning = updateData.pending_motor_running;
    if (updateData.pending_control_mode !== undefined) mappedUpdateData.pendingControlMode = updateData.pending_control_mode as 'auto' | 'manual';
    if (updateData.pending_target_active !== undefined) mappedUpdateData.pendingTargetActive = updateData.pending_target_active;
    if (updateData.pending_target_level !== undefined) mappedUpdateData.pendingTargetLevel = updateData.pending_target_level;
    if (updateData.pending_command_id !== undefined) mappedUpdateData.pendingCommandId = updateData.pending_command_id;
    if (updateData.pending_command_timestamp !== undefined) mappedUpdateData.pendingCommandTimestamp = updateData.pending_command_timestamp;

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
    // Use process.nextTick instead of setImmediate to prevent memory leaks
    process.nextTick(async () => {
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
    await this.redisService.setMotorCommand(deviceId, mcuCommand, 60); // 1 minute TTL for faster cleanup

    // Set pending state for the command
    const pendingState = this.calculatePendingState(command, mcuCommand.command_id);
    
    // Also set optimistic state for immediate UI feedback
    const optimisticState = this.calculateOptimisticState(command);
    
    const updatedState = await this.updateMotorState(deviceId, {
      ...pendingState,
      ...optimisticState, // Immediate optimistic updates
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
   * Handle MCU heartbeat with pending state resolution
   */
  async handleHeartbeat(heartbeat: MotorHeartbeatDto): Promise<MotorState> {
    const currentState = await this.getMotorState(heartbeat.device_id);
    
    // Check if any pending states should be cleared based on MCU confirmation
    const pendingClears = this.checkPendingStateResolution(currentState, heartbeat);
    
    const updateData: Partial<MotorStateUpdateDto> = {
      motor_running: heartbeat.motor_running,
      control_mode: heartbeat.control_mode,
      target_mode_active: heartbeat.target_mode_active,
      current_target_level: heartbeat.current_target_level,
      target_description: heartbeat.target_description,
      protection_active: heartbeat.protection_active,
      buzzer_muted: heartbeat.buzzer_muted,
      current_amps: heartbeat.current_amps,
      power_watts: heartbeat.power_watts,
      runtime_minutes: heartbeat.runtime_minutes,
      total_runtime_hours: heartbeat.total_runtime_hours,
      ...pendingClears, // Clear pending states if resolved
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
      buzzerMuted: false,
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
      case 'enable_buzzer':
        expectedState.buzzer_muted = false;
        break;
      case 'disable_buzzer':
        expectedState.buzzer_muted = true;
        break;
    }

    return expectedState;
  }

  private calculatePendingState(command: MotorControlCommandDto, commandId: string): Partial<MotorStateUpdateDto> {
    const pendingState: Partial<MotorStateUpdateDto> = {
      pending_command_id: commandId,
      pending_command_timestamp: new Date(),
    };

    switch (command.action) {
      case 'start':
        pendingState.pending_motor_running = true;
        pendingState.pending_target_active = false;
        break;
      case 'stop':
        pendingState.pending_motor_running = false;
        pendingState.pending_target_active = false;
        break;
      case 'target':
        pendingState.pending_motor_running = true;
        pendingState.pending_target_active = true;
        pendingState.pending_target_level = command.target_level;
        break;
      case 'auto':
        pendingState.pending_control_mode = 'auto';
        break;
      case 'manual':
        pendingState.pending_control_mode = 'manual';
        break;
      case 'reset_protection':
        // Protection reset doesn't have a pending state
        break;
    }

    return pendingState;
  }

  /**
   * Calculate optimistic state changes for immediate UI feedback
   */
  private calculateOptimisticState(command: MotorControlCommandDto): Partial<MotorStateUpdateDto> {
    const optimisticState: Partial<MotorStateUpdateDto> = {};

    switch (command.action) {
      case 'start':
        optimisticState.motor_running = true;
        optimisticState.target_mode_active = false;
        break;
      case 'stop':
        optimisticState.motor_running = false;
        optimisticState.target_mode_active = false;
        break;
      case 'target':
        optimisticState.motor_running = true;
        optimisticState.target_mode_active = true;
        optimisticState.current_target_level = command.target_level;
        optimisticState.target_description = `Target ${command.target_level}"`;
        break;
      case 'auto':
        optimisticState.control_mode = 'auto';
        break;
      case 'manual':
        optimisticState.control_mode = 'manual';
        break;
      case 'reset_protection':
        optimisticState.protection_active = false;
        break;
      case 'enable_buzzer':
        optimisticState.buzzer_muted = false;
        break;
      case 'disable_buzzer':
        optimisticState.buzzer_muted = true;
        break;
    }

    return optimisticState;
  }

  private checkPendingStateResolution(currentState: MotorState, heartbeat: MotorHeartbeatDto): Partial<MotorStateUpdateDto> {
    const pendingClears: Partial<MotorStateUpdateDto> = {};

    // Clear pending motor running state if MCU state matches pending state
    if (currentState.pendingMotorRunning !== undefined && 
        currentState.pendingMotorRunning === heartbeat.motor_running) {
      pendingClears.pending_motor_running = null;
      console.log(`Pending motor running state resolved: ${heartbeat.motor_running}`);
    }

    // Clear pending control mode if MCU state matches pending state
    if (currentState.pendingControlMode !== undefined && 
        currentState.pendingControlMode === heartbeat.control_mode) {
      pendingClears.pending_control_mode = null;
      console.log(`Pending control mode resolved: ${heartbeat.control_mode}`);
    }

    // Clear pending target active state if MCU state matches pending state
    if (currentState.pendingTargetActive !== undefined && 
        currentState.pendingTargetActive === heartbeat.target_mode_active) {
      pendingClears.pending_target_active = null;
      console.log(`Pending target active state resolved: ${heartbeat.target_mode_active}`);
    }

    // Clear pending target level if MCU state matches (with tolerance for floating point)
    if (currentState.pendingTargetLevel !== undefined && 
        heartbeat.current_target_level !== undefined &&
        Math.abs(currentState.pendingTargetLevel - heartbeat.current_target_level) < 0.1) {
      pendingClears.pending_target_level = null;
      console.log(`Pending target level resolved: ${heartbeat.current_target_level}`);
    }

    // Clear command ID and timestamp if any pending state was resolved
    if (Object.keys(pendingClears).length > 0) {
      pendingClears.pending_command_id = null;
      pendingClears.pending_command_timestamp = null;
    }

    return pendingClears;
  }
}
