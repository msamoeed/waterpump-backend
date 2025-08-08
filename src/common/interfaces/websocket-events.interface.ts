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

export interface ServerToClientEvents {
  device_update: (data: DeviceUpdateEvent) => void;
  pump_event: (data: PumpEvent) => void;
  alert_triggered: (data: AlertEvent) => void;
  device_offline: (data: DeviceOfflineEvent) => void;
  ota_update_available: (data: OTAUpdateEvent) => void;
  ota_progress_update: (data: OTAProgressEvent) => void;
  ota_update_complete: (data: OTACompleteEvent) => void;
  device_log: (data: DeviceLogEvent) => void;
}

export interface ClientToServerEvents {
  subscribe_device: (deviceId: string) => void;
  get_current_status: () => void;
  request_ota_update: (deviceId: string) => void;
  ota_progress: (data: { device_id: string; progress: number; status: string }) => void;
  ota_complete: (data: { device_id: string; success: boolean; version: string; error?: string }) => void;
} 