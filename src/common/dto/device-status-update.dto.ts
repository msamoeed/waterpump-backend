import { IsString, IsNumber, IsBoolean, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class TankDataDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  level_percent: number;

  @IsNumber()
  @Min(0)
  level_inches: number;

  @IsBoolean()
  alarm_active: boolean;

  @IsBoolean()
  connected: boolean;

  @IsBoolean()
  sensor_working: boolean;

  @IsBoolean()
  water_supply_on: boolean;
}

export class PumpDataDto {
  @IsBoolean()
  running: boolean;

  @IsBoolean()
  manual_override: boolean;

  @IsNumber()
  @Min(0)
  current_amps: number;

  @IsNumber()
  @Min(0)
  power_watts: number;

  @IsNumber()
  @Min(0)
  daily_consumption: number;

  @IsNumber()
  @Min(0)
  hourly_consumption: number;

  @IsNumber()
  @Min(0)
  runtime_minutes: number;

  @IsNumber()
  @Min(0)
  total_runtime_hours: number;

  @IsBoolean()
  protection_active: boolean;

  @IsBoolean()
  overcurrent_protection: boolean;

  @IsBoolean()
  overtime_protection: boolean;
}

export class SystemDataDto {
  @IsBoolean()
  auto_mode_enabled: boolean;

  @IsBoolean()
  manual_pump_control: boolean;

  @IsBoolean()
  water_supply_active: boolean;
}

export class DeviceStatusUpdateDto {
  @IsString()
  device_id: string;

  @IsNumber()
  timestamp: number;

  @ValidateNested()
  @Type(() => TankDataDto)
  ground_tank: TankDataDto;

  @ValidateNested()
  @Type(() => TankDataDto)
  roof_tank: TankDataDto;

  @ValidateNested()
  @Type(() => PumpDataDto)
  pump: PumpDataDto;

  @ValidateNested()
  @Type(() => SystemDataDto)
  system: SystemDataDto;
} 