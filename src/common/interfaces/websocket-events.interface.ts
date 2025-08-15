import { DeviceStatusUpdateDto } from '../dto/device-status-update.dto';

export interface DeviceUpdateEvent {
  device_id: string;
  status: DeviceStatusUpdateDto;
  timestamp: string;
}

export interface PumpEvent {
  event_type: 'pump_start' | 'pump_stop' | 'protection_active' | 'usage_reset' | 'pump_command';
  pump_on: boolean;
  trigger_reason: string;
  ground_tank_level: number;
  roof_tank_level: number;
  pump_current: number;
  pump_power: number;
  protection_active: boolean;
  timestamp: string;
}

export interface AlertEvent {
  device_id: string;
  alert_type: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
}

export interface DeviceOfflineEvent {
  device_id: string;
  last_seen: string;
  offline_duration: number;
}

export interface OTAUpdateEvent {
  device_id: string;
  version: string;
  download_url: string;
  manifest: any;
  timestamp: string;
}

export interface OTAProgressEvent {
  device_id: string;
  progress: number;
  status: string;
  timestamp: string;
}

export interface OTACompleteEvent {
  device_id: string;
  success: boolean;
  version: string;
  error?: string;
  timestamp: string;
}

export interface DeviceLogEvent {
  device_id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export interface SystemDataEvent {
  device_id: string;
  motor_state: {
    device_id?: string;
    motor_running: boolean;
    control_mode: 'auto' | 'manual';
    target_mode_active: boolean;
    current_target_level?: number;
    target_description?: string;
    protection_active: boolean;
    current_amps: number;
    power_watts: number;
    runtime_minutes: number;
    total_runtime_hours: number;
    mcu_online: boolean;
    last_command_source?: string;
    last_command_reason?: string;
    created_at?: string;
    updated_at?: string;
    last_heartbeat?: string;
    // Pending states
    pending_motor_running?: boolean;
    pending_control_mode?: 'auto' | 'manual';
    pending_target_active?: boolean;
    pending_target_level?: number;
    pending_command_id?: string;
    pending_command_timestamp?: string;
  };
  device_status: {
    ground_tank: {
      level_percent: number;
      level_inches: number;
      alarm_active: boolean;
      connected: boolean;
      sensor_working: boolean;
      water_supply_on: boolean;
    };
    roof_tank: {
      level_percent: number;
      level_inches: number;
      alarm_active: boolean;
      connected: boolean;
      sensor_working: boolean;
      water_supply_on: boolean;
    };
    ground_pump: {
      running: boolean;
      manual_override: boolean;
      current_amps: number;
      power_watts: number;
      daily_consumption: number;
      hourly_consumption: number;
      runtime_minutes: number;
      total_runtime_hours: number;
      protection_active: boolean;
      overcurrent_protection: boolean;
      overtime_protection: boolean;
    };
    roof_pump: {
      running: boolean;
      manual_override: boolean;
      current_amps: number;
      power_watts: number;
      daily_consumption: number;
      hourly_consumption: number;
      runtime_minutes: number;
      total_runtime_hours: number;
      protection_active: boolean;
      overcurrent_protection: boolean;
      overtime_protection: boolean;
    };
    system: {
      auto_mode_enabled: boolean;
      manual_pump_control: boolean;
      water_supply_active: boolean;
    };
  };
  alerts: Array<{
    id: string;
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    created_at: string;
    expires_at?: string;
  }>;
  timestamp: string;
}

export interface ServerToClientEvents {
  device_update: (data: DeviceUpdateEvent) => void;
  pump_event: (data: PumpEvent) => void;
  alert_triggered: (data: AlertEvent) => void;
  device_offline: (data: DeviceOfflineEvent) => void;
  ota_update_available: (data: OTAUpdateEvent) => void;
  ota_progress_update: (data: OTAProgressEvent) => void;
  ota_update_complete: (data: OTACompleteEvent) => void;
  device_log: (data: DeviceLogEvent) => void;
  system_data: (data: SystemDataEvent) => void;
}

export interface ClientToServerEvents {
  subscribe_device: (deviceId: string) => void;
  get_current_status: () => void;
  get_system_data: (deviceId: string) => void;
  subscribe_system_data: (deviceId: string) => void;
  request_ota_update: (deviceId: string) => void;
  ota_progress: (data: { device_id: string; progress: number; status: string }) => void;
  ota_complete: (data: { device_id: string; success: boolean; version: string; error?: string }) => void;
} 