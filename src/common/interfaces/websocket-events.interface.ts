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

export interface ProtectionResetResponseEvent {
  success: boolean;
  message?: string;
  error?: string;
  device_id: string;
  reason?: string;
  timestamp: string;
}

export interface OTAUpdateResponseEvent {
  success: boolean;
  message?: string;
  error?: string;
  device_id: string;
  version?: string;
  timestamp: string;
}

export interface WaterSupplyNotificationEvent {
  device_id: string;
  tank_id: 'ground' | 'roof' | 'system';
  water_supply_on: boolean;
  previous_state: boolean;
  timestamp: string;
  reason?: string;
}

export interface SensorStatusNotificationEvent {
  device_id: string;
  tank_id: 'ground' | 'roof';
  sensor_connected: boolean;
  sensor_working: boolean;
  previous_connected: boolean;
  previous_working: boolean;
  timestamp: string;
  reason?: string;
}

export interface SensorMonitoringUpdateEvent {
  device_id: string;
  ground_sensor: {
    connected: boolean;
    working: boolean;
  };
  roof_sensor: {
    connected: boolean;
    working: boolean;
  };
  pump_status: {
    running: boolean;
    paused_by_sensor: boolean;
  };
  timestamp: string;
}

export interface PumpPausedSensorEvent {
  device_id: string;
  reason: string;
  sensor_status: {
    groundSensorConnected: boolean;
    roofSensorConnected: boolean;
    groundSensorWorking: boolean;
    roofSensorWorking: boolean;
  };
  timestamp: string;
  action: 'paused';
}

export interface PumpPauseDetailsEvent {
  device_id: string;
  pause_reason: 'sensor_offline' | 'sensor_malfunction' | 'manual_override' | 'system_error';
  pause_details: {
    ground_sensor: {
      connected: boolean;
      working: boolean;
      last_reading?: number;
      last_reading_time?: string;
      error_type?: 'disconnected' | 'no_data' | 'invalid_reading' | 'timeout';
    };
    roof_sensor: {
      connected: boolean;
      working: boolean;
      last_reading?: number;
      last_reading_time?: string;
      error_type?: 'disconnected' | 'no_data' | 'invalid_reading' | 'timeout';
    };
    pump_state_before_pause: {
      running: boolean;
      mode: 'auto' | 'manual';
      target_level?: number;
      runtime_minutes: number;
    };
    estimated_resume_time?: string;
    requires_manual_intervention: boolean;
  };
  timestamp: string;
  severity: 'warning' | 'high' | 'critical';
}

export interface PumpResumedSensorEvent {
  device_id: string;
  reason: string;
  sensor_status: {
    groundSensorConnected: boolean;
    roofSensorConnected: boolean;
    groundSensorWorking: boolean;
    roofSensorWorking: boolean;
  };
  timestamp: string;
  action: 'resumed';
}

export interface SensorOverrideUpdateEvent {
  device_id: string;
  override_enabled: boolean;
  reason: string;
  timestamp: string;
}

export interface SystemAlertEvent {
  type: 'sensor_offline' | 'sensor_recovered' | 'pump_paused' | 'pump_resumed';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  device_id: string;
  timestamp: string;
}

export interface SensorStatusResponseEvent {
  success: boolean;
  data?: {
    device_id: string;
    sensor_monitoring_active: boolean;
    is_overridden: boolean;
    pause_status: any;
    timestamp: string;
  };
  error?: string;
  device_id: string;
  timestamp: string;
}

export interface SensorOverrideResponseEvent {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    device_id: string;
    override_enabled: boolean;
    reason?: string;
    timestamp: string;
  };
  device_id: string;
  timestamp: string;
}

export interface SensorCheckResponseEvent {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    device_id: string;
    timestamp: string;
  };
  device_id: string;
  timestamp: string;
}

export interface DeviceLogEvent {
  device_id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export interface ClearPendingStatesResponseEvent {
  device_id: string;
  success: boolean;
  message: string;
  reason: string;
  motor_state?: any;
  timestamp: string;
}

export interface SystemDataEvent {
  device_id: string;
  motor_state: {
    motorRunning: boolean;
    controlMode: 'auto' | 'manual';
    targetModeActive: boolean;
    currentTargetLevel?: number;
    targetDescription?: string;
    protectionActive: boolean;
    currentAmps: number;
    powerWatts: number;
    runtimeMinutes: number;
    totalRuntimeHours: number;
    mcuOnline: boolean;
    lastCommandSource?: string;
    lastCommandReason?: string;
    // Pending states
    pendingMotorRunning?: boolean;
    pendingControlMode?: 'auto' | 'manual';
    pendingTargetActive?: boolean;
    pendingTargetLevel?: number;
    pendingCommandId?: string;
    pendingCommandTimestamp?: string;
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

export interface MotorControlResponseEvent {
  device_id: string;
  success: boolean;
  action: 'start' | 'stop' | 'target';
  message: string;
  motor_state?: any; // Updated motor state after command
  timestamp: string;
  target_level?: number;
  conflict_resolution?: {
    type?: string;
    reason?: string;
    currentState?: any;
    suggestedAction?: string;
    message?: string;
  };
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
  motor_control_response: (data: MotorControlResponseEvent) => void;
  protection_reset_response: (data: ProtectionResetResponseEvent) => void;
  ota_update_response: (data: OTAUpdateResponseEvent) => void;
  water_supply_notification: (data: WaterSupplyNotificationEvent) => void;
  sensor_status_notification: (data: SensorStatusNotificationEvent) => void;
  sensor_monitoring_update: (data: SensorMonitoringUpdateEvent) => void;
  pump_paused_sensor: (data: PumpPausedSensorEvent) => void;
  pump_pause_details: (data: PumpPauseDetailsEvent) => void;
  pump_resumed_sensor: (data: PumpResumedSensorEvent) => void;
  sensor_override_update: (data: SensorOverrideUpdateEvent) => void;
  system_alert: (data: SystemAlertEvent) => void;
  sensor_status_response: (data: SensorStatusResponseEvent) => void;
  sensor_override_response: (data: SensorOverrideResponseEvent) => void;
  sensor_check_response: (data: SensorCheckResponseEvent) => void;
  clear_pending_states_response: (data: ClearPendingStatesResponseEvent) => void;
}

export interface ClientToServerEvents {
  subscribe_device: (deviceId: string) => void;
  get_current_status: () => void;
  get_system_data: (deviceId: string) => void;
  subscribe_system_data: (deviceId: string) => void;
  request_ota_update: (deviceId: string) => void;
  ota_progress: (data: { device_id: string; progress: number; status: string }) => void;
  ota_complete: (data: { device_id: string; success: boolean; version: string; error?: string }) => void;
  motor_control: (data: { device_id: string; action: 'start' | 'stop'; reason?: string }) => void;
  reset_protection: (data: { device_id: string; reason?: string }) => void;
  ota_update_response: (data: { success: boolean; message?: string; error?: string; device_id: string; version?: string; timestamp: string }) => void;
  get_sensor_status: (deviceId: string) => void;
  override_sensor_monitoring: (data: { device_id: string; enable: boolean; reason?: string }) => void;
  force_sensor_check: (deviceId: string) => void;
  clear_pending_states: (data: { device_id: string; reason?: string }) => void;
} 