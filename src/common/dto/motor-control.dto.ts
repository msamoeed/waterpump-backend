import { IsString, IsBoolean, IsNumber, IsOptional, IsIn, Min, Max } from 'class-validator';

export class MotorControlCommandDto {
  @IsString()
  @IsOptional()
  device_id?: string;

  @IsString()
  @IsIn(['start', 'stop', 'target', 'auto', 'manual', 'reset_protection'])
  action: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  target_level?: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  @IsIn(['mobile', 'mcu', 'api', 'auto'])
  source?: string;
}

export class MotorStateUpdateDto {
  @IsString()
  device_id: string;

  @IsBoolean()
  @IsOptional()
  motor_running?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['auto', 'manual'])
  control_mode?: string;

  @IsBoolean()
  @IsOptional()
  target_mode_active?: boolean;

  @IsNumber()
  @IsOptional()
  current_target_level?: number;

  @IsString()
  @IsOptional()
  target_description?: string;

  @IsBoolean()
  @IsOptional()
  protection_active?: boolean;

  @IsNumber()
  @IsOptional()
  current_amps?: number;

  @IsNumber()
  @IsOptional()
  power_watts?: number;

  @IsNumber()
  @IsOptional()
  runtime_minutes?: number;

  @IsNumber()
  @IsOptional()
  total_runtime_hours?: number;

  @IsString()
  @IsOptional()
  last_command_source?: string;

  @IsString()
  @IsOptional()
  last_command_reason?: string;

  // Pending state fields
  @IsBoolean()
  @IsOptional()
  pending_motor_running?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['auto', 'manual'])
  pending_control_mode?: string;

  @IsBoolean()
  @IsOptional()
  pending_target_active?: boolean;

  @IsNumber()
  @IsOptional()
  pending_target_level?: number;

  @IsString()
  @IsOptional()
  pending_command_id?: string;

  @IsOptional()
  pending_command_timestamp?: Date;
}

export class MotorHeartbeatDto {
  @IsString()
  device_id: string;

  @IsBoolean()
  motor_running: boolean;

  @IsString()
  @IsIn(['auto', 'manual'])
  control_mode: string;

  @IsBoolean()
  @IsOptional()
  target_mode_active?: boolean;

  @IsNumber()
  @IsOptional()
  current_target_level?: number;

  @IsString()
  @IsOptional()
  target_description?: string;

  @IsBoolean()
  protection_active: boolean;

  @IsNumber()
  current_amps: number;

  @IsNumber()
  power_watts: number;

  @IsNumber()
  runtime_minutes: number;

  @IsNumber()
  total_runtime_hours: number;
}
