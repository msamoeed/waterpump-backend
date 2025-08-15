export interface SensorMonitorEvents {
  emitSensorStatusUpdate(deviceId: string, status: any): void;
  emitPumpPauseEvent(deviceId: string, data: any): void;
  emitPumpResumeEvent(deviceId: string, data: any): void;
  emitDetailedPumpPauseEvent(deviceId: string, data: any): void;
  emitSensorOverrideEvent(deviceId: string, data: any): void;
  emitSystemAlert(data: any): void;
  emitSystemDataUpdate(deviceId: string): void;
  emitPumpPauseDetails(deviceId: string, data: any): void;
  emitSensorMonitoringUpdate(deviceId: string, data: any): void;
  emitSensorOverrideUpdate(deviceId: string, data: any): void;
}
