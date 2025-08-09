import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('motor_states')
export class MotorState {
  @PrimaryColumn({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'motor_running', default: false })
  motorRunning: boolean;

  @Column({ name: 'control_mode', default: 'auto' })
  controlMode: 'auto' | 'manual';

  @Column({ name: 'target_mode_active', default: false })
  targetModeActive: boolean;

  @Column({ name: 'current_target_level', type: 'float', nullable: true })
  currentTargetLevel?: number;

  @Column({ name: 'target_description', nullable: true })
  targetDescription?: string;

  @Column({ name: 'protection_active', default: false })
  protectionActive: boolean;

  @Column({ name: 'last_command_source', nullable: true })
  lastCommandSource?: string; // 'mobile', 'mcu', 'api', 'auto'

  @Column({ name: 'last_command_reason', nullable: true })
  lastCommandReason?: string;

  @Column({ name: 'current_amps', type: 'float', default: 0 })
  currentAmps: number;

  @Column({ name: 'power_watts', type: 'float', default: 0 })
  powerWatts: number;

  @Column({ name: 'runtime_minutes', type: 'int', default: 0 })
  runtimeMinutes: number;

  @Column({ name: 'total_runtime_hours', type: 'int', default: 0 })
  totalRuntimeHours: number;

  @Column({ name: 'last_heartbeat', type: 'timestamp', nullable: true })
  lastHeartbeat?: Date;

  @Column({ name: 'mcu_online', default: false })
  mcuOnline: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
