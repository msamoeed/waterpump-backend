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
  async processMotorCommand(command: MotorControlCommandDto): Promise<{ success: boolean; state: MotorState; conflictResolution?: any }> {
    const deviceId = command.device_id || 'esp32_controller_001';
    const currentState = await this.getMotorState(deviceId);

    // Check for command conflicts and resolve them
    const conflictResolution = await this.resolveCommandConflicts(command, currentState);
    
    if (conflictResolution.shouldReject) {
      return {
        success: false,
        state: currentState,
        conflictResolution: {
          reason: conflictResolution.reason,
          currentState: conflictResolution.currentState,
          suggestedAction: conflictResolution.suggestedAction,
        }
      };
    }

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

    return { 
      success: true, 
      state: updatedState,
      conflictResolution: conflictResolution.resolution ? conflictResolution.resolution : undefined
    };
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
   * Clear stuck pending states (timeout after 2 minutes)
   */
  async clearStuckPendingStates(): Promise<void> {
    const timeoutThreshold = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes

    const stuckStates = await this.motorStateRepository
      .createQueryBuilder()
      .where('pending_command_timestamp < :threshold', { threshold: timeoutThreshold })
      .andWhere('(pending_motor_running IS NOT NULL OR pending_control_mode IS NOT NULL OR pending_target_active IS NOT NULL OR pending_target_level IS NOT NULL)')
      .getMany();

    for (const state of stuckStates) {
      console.log(`Clearing stuck pending states for device: ${state.deviceId}`);
      
      await this.updateMotorState(state.deviceId, {
        pending_motor_running: null,
        pending_control_mode: null,
        pending_target_active: null,
        pending_target_level: null,
        pending_command_id: null,
        pending_command_timestamp: null,
      });

      // Log the timeout
      await this.postgresService.insertEventLog({
        device_id: state.deviceId,
        event_type: 'pending_state_timeout',
        message: 'Pending states cleared due to timeout (2 minutes)',
        severity: 'warning',
      });
    }
  }

  /**
   * Force clear all pending states for a device (emergency cleanup)
   */
  async forceClearAllPendingStates(deviceId: string): Promise<MotorState> {
    console.log(`Force clearing ALL pending states for device: ${deviceId}`);
    
    const updatedState = await this.updateMotorState(deviceId, {
      pending_motor_running: null,
      pending_control_mode: null,
      pending_target_active: null,
      pending_target_level: null,
      pending_command_id: null,
      pending_command_timestamp: null,
    });

    // Log the force clear
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'pending_state_force_cleared',
      message: 'All pending states force cleared (emergency cleanup)',
      severity: 'warning',
    });

    return updatedState;
  }

  /**
   * Check for orphaned pending states (MCU offline for extended period)
   */
  async checkOrphanedPendingStates(): Promise<void> {
    const offlineThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes offline

    const orphanedStates = await this.motorStateRepository
      .createQueryBuilder()
      .where('mcu_online = :online', { online: false })
      .andWhere('last_heartbeat < :threshold', { threshold: offlineThreshold })
      .andWhere('(pending_motor_running IS NOT NULL OR pending_control_mode IS NOT NULL OR pending_target_active IS NOT NULL OR pending_target_level IS NOT NULL)')
      .getMany();

    for (const state of orphanedStates) {
      console.log(`Clearing orphaned pending states for offline device: ${state.deviceId}`);
      
      await this.updateMotorState(state.deviceId, {
        pending_motor_running: null,
        pending_control_mode: null,
        pending_target_active: null,
        pending_target_level: null,
        pending_command_id: null,
        pending_command_timestamp: null,
      });

      // Log the orphaned clear
      await this.postgresService.insertEventLog({
        device_id: state.deviceId,
        event_type: 'pending_state_orphaned_cleared',
        message: 'Pending states cleared for offline device (5+ minutes)',
        severity: 'warning',
      });
    }
  }

  /**
   * Manually clear all pending states for a device
   */
  async clearPendingStates(deviceId: string): Promise<MotorState> {
    console.log(`Manually clearing pending states for device: ${deviceId}`);
    
    const updatedState = await this.updateMotorState(deviceId, {
      pending_motor_running: null,
      pending_control_mode: null,
      pending_target_active: null,
      pending_target_level: null,
      pending_command_id: null,
      pending_command_timestamp: null,
    });

    // Log the manual clear
    await this.postgresService.insertEventLog({
      device_id: deviceId,
      event_type: 'pending_state_cleared',
      message: 'Pending states manually cleared',
      severity: 'info',
    });

    return updatedState;
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

  /**
   * Resolve command conflicts and provide intelligent suggestions
   */
  private async resolveCommandConflicts(command: MotorControlCommandDto, currentState: MotorState): Promise<{
    shouldReject: boolean;
    reason?: string;
    currentState?: any;
    suggestedAction?: string;
    resolution?: any;
  }> {
    const deviceId = command.device_id || 'esp32_controller_001';
    
    // Check if there's a pending command that conflicts
    const pendingCommand = await this.redisService.getMotorCommand(deviceId);
    if (pendingCommand) {
      const pendingData = JSON.parse(pendingCommand);
      const timeSincePending = Date.now() - new Date(pendingData.timestamp).getTime();
      
      // If there's a recent pending command (within 30 seconds), check for conflicts
      if (timeSincePending < 30000) {
        const conflict = this.detectCommandConflict(command, pendingData, currentState);
        if (conflict.hasConflict) {
          return {
            shouldReject: true,
            reason: conflict.reason,
            currentState: {
              motorRunning: currentState.motorRunning,
              pendingCommand: pendingData,
              lastCommandSource: currentState.lastCommandSource,
              lastCommandReason: currentState.lastCommandReason,
            },
            suggestedAction: conflict.suggestedAction,
          };
        }
      }
    }

    // Check for redundant commands
    const redundantCheck = this.checkRedundantCommand(command, currentState);
    if (redundantCheck.isRedundant) {
      return {
        shouldReject: true,
        reason: redundantCheck.reason,
        currentState: {
          motorRunning: currentState.motorRunning,
          targetModeActive: currentState.targetModeActive,
          currentTargetLevel: currentState.currentTargetLevel,
        },
        suggestedAction: redundantCheck.suggestedAction,
      };
    }

    // Check for state synchronization issues
    const syncIssue = await this.checkStateSyncIssue(command, currentState);
    if (syncIssue.hasIssue) {
      return {
        shouldReject: false, // Don't reject, but provide resolution info
        resolution: {
          type: 'sync_issue',
          message: syncIssue.message,
          suggestedAction: syncIssue.suggestedAction,
          currentState: syncIssue.currentState,
        }
      };
    }

    return { shouldReject: false };
  }

  /**
   * Detect conflicts between new command and pending command
   */
  private detectCommandConflict(newCommand: MotorControlCommandDto, pendingCommand: any, currentState: MotorState): {
    hasConflict: boolean;
    reason?: string;
    suggestedAction?: string;
  } {
    // Same action conflict
    if (newCommand.action === pendingCommand.action) {
      return {
        hasConflict: true,
        reason: `Command '${newCommand.action}' is already pending. Please wait for the current command to complete.`,
        suggestedAction: 'Wait for current command to complete or check device status',
      };
    }

    // Opposite action conflict (start vs stop)
    if ((newCommand.action === 'start' && pendingCommand.action === 'stop') ||
        (newCommand.action === 'stop' && pendingCommand.action === 'start')) {
      return {
        hasConflict: true,
        reason: `Cannot ${newCommand.action} motor while ${pendingCommand.action} command is pending.`,
        suggestedAction: 'Wait for current command to complete or clear pending states',
      };
    }

    // Target mode conflicts
    if (newCommand.action === 'target' && pendingCommand.action === 'stop') {
      return {
        hasConflict: true,
        reason: 'Cannot set target while stop command is pending.',
        suggestedAction: 'Wait for stop command to complete or clear pending states',
      };
    }

    return { hasConflict: false };
  }

  /**
   * Check for redundant commands
   */
  private checkRedundantCommand(command: MotorControlCommandDto, currentState: MotorState): {
    isRedundant: boolean;
    reason?: string;
    suggestedAction?: string;
  } {
    // Redundant start command
    if (command.action === 'start' && currentState.motorRunning && !currentState.pendingMotorRunning) {
      return {
        isRedundant: true,
        reason: 'Motor is already running. No action needed.',
        suggestedAction: 'Motor is already running',
      };
    }

    // Redundant stop command
    if (command.action === 'stop' && !currentState.motorRunning && currentState.pendingMotorRunning !== true) {
      return {
        isRedundant: true,
        reason: 'Motor is already stopped. No action needed.',
        suggestedAction: 'Motor is already stopped',
      };
    }

    // Redundant target command with same level
    if (command.action === 'target' && 
        currentState.targetModeActive && 
        currentState.currentTargetLevel === command.target_level &&
        !currentState.pendingTargetActive) {
      return {
        isRedundant: true,
        reason: `Target mode is already active with the same level (${command.target_level} inches).`,
        suggestedAction: 'Target is already set to the same level',
      };
    }

    return { isRedundant: false };
  }

  /**
   * Check for state synchronization issues
   */
  private async checkStateSyncIssue(command: MotorControlCommandDto, currentState: MotorState): Promise<{
    hasIssue: boolean;
    message?: string;
    suggestedAction?: string;
    currentState?: any;
  }> {
    // Check if there are old pending states that might indicate sync issues
    if (currentState.pendingCommandTimestamp) {
      const pendingAge = Date.now() - currentState.pendingCommandTimestamp.getTime();
      if (pendingAge > 60000) { // 1 minute
        return {
          hasIssue: true,
          message: 'There are old pending states that may indicate a synchronization issue.',
          suggestedAction: 'Consider clearing pending states before sending new commands',
          currentState: {
            pendingCommandId: currentState.pendingCommandId,
            pendingCommandTimestamp: currentState.pendingCommandTimestamp,
            pendingMotorRunning: currentState.pendingMotorRunning,
          }
        };
      }
    }

    // Check if MCU is offline but we have pending states
    if (!currentState.mcuOnline && (currentState.pendingMotorRunning !== undefined || currentState.pendingCommandId)) {
      return {
        hasIssue: true,
        message: 'MCU is offline but there are pending states. Commands may not be processed.',
        suggestedAction: 'Wait for MCU to come online or clear pending states',
        currentState: {
          mcuOnline: currentState.mcuOnline,
          pendingCommandId: currentState.pendingCommandId,
          lastHeartbeat: currentState.lastHeartbeat,
        }
      };
    }

    return { hasIssue: false };
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

    console.log(`[PENDING RESOLUTION] Checking pending states for device ${heartbeat.device_id}`);
    console.log(`[PENDING RESOLUTION] Current pending states:`, {
      pendingMotorRunning: currentState.pendingMotorRunning,
      pendingTargetActive: currentState.pendingTargetActive,
      pendingControlMode: currentState.pendingControlMode,
      pendingTargetLevel: currentState.pendingTargetLevel,
    });
    console.log(`[PENDING RESOLUTION] Heartbeat states:`, {
      motor_running: heartbeat.motor_running,
      target_mode_active: heartbeat.target_mode_active,
      control_mode: heartbeat.control_mode,
      current_target_level: heartbeat.current_target_level,
    });

    // Clear pending motor running state if MCU state matches pending state
    if (currentState.pendingMotorRunning !== null && 
        currentState.pendingMotorRunning !== undefined &&
        currentState.pendingMotorRunning === heartbeat.motor_running) {
      pendingClears.pending_motor_running = null;
      console.log(`✅ Pending motor running state resolved: ${heartbeat.motor_running}`);
    } else if (currentState.pendingMotorRunning !== null && currentState.pendingMotorRunning !== undefined) {
      console.log(`❌ Pending motor running state NOT resolved: pending=${currentState.pendingMotorRunning}, actual=${heartbeat.motor_running}`);
    } else if (currentState.pendingMotorRunning === null) {
      console.log(`ℹ️ Pending motor running state already cleared (null)`);
    }

    // Clear pending control mode if MCU state matches pending state
    if (currentState.pendingControlMode !== null && 
        currentState.pendingControlMode !== undefined &&
        currentState.pendingControlMode === heartbeat.control_mode) {
      pendingClears.pending_control_mode = null;
      console.log(`✅ Pending control mode resolved: ${heartbeat.control_mode}`);
    } else if (currentState.pendingControlMode !== null && currentState.pendingControlMode !== undefined) {
      console.log(`❌ Pending control mode NOT resolved: pending=${currentState.pendingControlMode}, actual=${heartbeat.control_mode}`);
    } else if (currentState.pendingControlMode === null) {
      console.log(`ℹ️ Pending control mode already cleared (null)`);
    }

    // Clear pending target active state if MCU state matches pending state
    if (currentState.pendingTargetActive !== null && 
        currentState.pendingTargetActive !== undefined &&
        heartbeat.target_mode_active !== undefined &&
        currentState.pendingTargetActive === heartbeat.target_mode_active) {
      pendingClears.pending_target_active = null;
      console.log(`✅ Pending target active state resolved: ${heartbeat.target_mode_active}`);
    } else if (currentState.pendingTargetActive !== null && currentState.pendingTargetActive !== undefined) {
      console.log(`❌ Pending target active state NOT resolved: pending=${currentState.pendingTargetActive}, actual=${heartbeat.target_mode_active} (undefined=${heartbeat.target_mode_active === undefined})`);
      
      // Fallback: If target_mode_active is undefined in heartbeat, assume it's false (not in target mode)
      // This handles cases where the MCU doesn't send this field
      if (heartbeat.target_mode_active === undefined && currentState.pendingTargetActive === false) {
        pendingClears.pending_target_active = null;
        console.log(`✅ Pending target active state resolved via fallback (assumed false): ${currentState.pendingTargetActive}`);
      }
    } else if (currentState.pendingTargetActive === null) {
      console.log(`ℹ️ Pending target active state already cleared (null)`);
    }

    // Clear pending target level if MCU state matches (with tolerance for floating point)
    if (currentState.pendingTargetLevel !== null && 
        currentState.pendingTargetLevel !== undefined &&
        heartbeat.current_target_level !== undefined &&
        Math.abs(currentState.pendingTargetLevel - heartbeat.current_target_level) < 0.1) {
      pendingClears.pending_target_level = null;
      console.log(`✅ Pending target level resolved: ${heartbeat.current_target_level}`);
    } else if (currentState.pendingTargetLevel !== null && currentState.pendingTargetLevel !== undefined) {
      console.log(`❌ Pending target level NOT resolved: pending=${currentState.pendingTargetLevel}, actual=${heartbeat.current_target_level}`);
    } else if (currentState.pendingTargetLevel === null) {
      console.log(`ℹ️ Pending target level already cleared (null)`);
    }

    // Additional safety: Clear all pending states if MCU is offline or if command is very old
    const commandAge = currentState.pendingCommandTimestamp ? 
      Date.now() - currentState.pendingCommandTimestamp.getTime() : 0;
    
    if (commandAge > 10 * 60 * 1000) { // 10 minutes
      console.log(`⚠️ Clearing old pending states (${Math.round(commandAge / 60000)} minutes old)`);
      pendingClears.pending_motor_running = null;
      pendingClears.pending_control_mode = null;
      pendingClears.pending_target_active = null;
      pendingClears.pending_target_level = null;
    }

    // Clear command ID and timestamp if any pending state was resolved
    if (Object.keys(pendingClears).length > 0) {
      pendingClears.pending_command_id = null;
      pendingClears.pending_command_timestamp = null;
      console.log(`✅ Clearing command metadata: ${Object.keys(pendingClears).join(', ')}`);
    } else {
      console.log(`ℹ️ No pending states resolved in this heartbeat`);
    }

    return pendingClears;
  }
}
