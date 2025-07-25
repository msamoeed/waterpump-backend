import { DeviceStatusUpdateDto } from '../dto/device-status-update.dto';

export interface DeviceUpdateEvent {
  device_id: string;
  status: DeviceStatusUpdateDto;
  timestamp: string;
}

export interface PumpEvent {
  event_type: 'pump_start' | 'pump_stop' | 'protection_active' | 'usage_reset';
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

export interface ServerToClientEvents {
  device_update: (data: DeviceUpdateEvent) => void;
  pump_event: (data: PumpEvent) => void;
  alert_triggered: (data: AlertEvent) => void;
  device_offline: (data: DeviceOfflineEvent) => void;
}

export interface ClientToServerEvents {
  subscribe_device: (deviceId: string) => void;
  get_current_status: () => void;
} 