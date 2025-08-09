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
   * Get the current motor state for a device (single source of truth)
   */
  async getMotorState(deviceId: string): Promise<MotorState> {
    // Try Redis cache first
    const cachedState = await this.redisService.get(`motor_state:${deviceId}`);
    if (cachedState) {
      return JSON.parse(cachedState);
    }

    // Fallback to database
    let motorState = await this.motorStateRepository.findOne({
      where: { deviceId }
    });

    if (!motorState) {
      // Create default state for new devices
      motorState = await this.createDefaultMotorState(deviceId);
    }

    // Cache the state in Redis
    await this.redisService.set(
      `motor_state:${deviceId}`, 
      JSON.stringify(motorState), 
      300 // 5 minutes TTL
    );

    return motorState;
  }

  /**
   * Update motor state (called by MCU heartbeat or state changes)
   */
  async updateMotorState(deviceId: string, updateData: Partial<MotorStateUpdateDto>): Promise<MotorState> {
    let motorState = await this.motorStateRepository.findOne({
      where: { deviceId }
    });

    if (!motorState) {
      motorState = await this.createDefaultMotorState(deviceId);
    }

    // Update fields
    Object.assign(motorState, {
      ...updateData,
      lastHeartbeat: new Date(),
      mcuOnline: true,
      updatedAt: new Date(),
    });

    // Save to database
    motorState = await this.motorStateRepository.save(motorState);

    // Update Redis cache
    await this.redisService.set(
      `motor_state:${deviceId}`, 
      JSON.stringify(motorState), 
      300 // 5 minutes TTL
    );

    // Log state change
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'motor_state_update',
      message: `Motor state updated: ${JSON.stringify(updateData)}`,
      severity: 'info',
    });

    return motorState;
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
    await this.redisService.set(
      `motor_command:${deviceId}`, 
      JSON.stringify(mcuCommand), 
      120 // 2 minutes TTL
    );

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
   * Get pending command for MCU
   */
  async getPendingCommand(deviceId: string): Promise<any> {
    const commandKey = `motor_command:${deviceId}`;
    const commandData = await this.redisService.get(commandKey);
    
    if (commandData) {
      // Mark command as retrieved (don't delete yet, let MCU acknowledge)
      const command = JSON.parse(commandData);
      command.retrieved_at = new Date().toISOString();
      await this.redisService.set(commandKey, JSON.stringify(command), 60); // Reduce TTL to 1 minute
      return command;
    }
    
    return null;
  }

  /**
   * Acknowledge command execution by MCU
   */
  async acknowledgeCommand(deviceId: string, commandId: string, success: boolean): Promise<void> {
    const commandKey = `motor_command:${deviceId}`;
    await this.redisService.del(commandKey);

    // Log acknowledgment
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'motor_command_ack',
      message: `Command ${commandId} ${success ? 'executed successfully' : 'failed'}`,
      severity: success ? 'info' : 'warning',
    });
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
