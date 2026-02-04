import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../entities/device.entity';
import { AlertRule } from '../entities/alert-rule.entity';
import { EventLog } from '../entities/event-log.entity';

@Injectable()
export class PostgresService {
  constructor(
    private configService: ConfigService,
    @InjectRepository(Device)
    private deviceRepository: Repository<Device>,
    @InjectRepository(AlertRule)
    private alertRuleRepository: Repository<AlertRule>,
    @InjectRepository(EventLog)
    private eventLogRepository: Repository<EventLog>,
  ) {}

  // Device operations
  async createDevice(deviceData: Partial<Device>): Promise<Device> {
    if (!deviceData.device_id) {
      throw new Error('device_id is required to create a device');
    }

    // Idempotent insert to avoid duplicate-key errors under retries/concurrency.
    // This preserves existing DB values (no overwrites) and ensures a Device is returned.
    await this.deviceRepository
      .createQueryBuilder()
      .insert()
      .into(Device)
      .values(deviceData)
      .orIgnore()
      .execute();

    // Load and return the device (either newly inserted or pre-existing if we raced).
    const device = await this.deviceRepository.findOne({
      where: { device_id: deviceData.device_id },
    });
    if (!device) {
      throw new Error(`Failed to create or load device: ${deviceData.device_id}`);
    }
    return device;
  }

  async getDevice(deviceId: string): Promise<Device | null> {
    return await this.deviceRepository.findOne({
      where: { device_id: deviceId },
      relations: ['alert_rules', 'event_logs'],
    });
  }

  async getAllDevices(): Promise<Device[]> {
    return await this.deviceRepository.find({
      relations: ['alert_rules'],
    });
  }

  async updateDevice(deviceId: string, updateData: Partial<Device>): Promise<Device | null> {
    await this.deviceRepository.update({ device_id: deviceId }, updateData);
    return await this.getDevice(deviceId);
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await this.deviceRepository.delete({ device_id: deviceId });
  }

  // Alert rule operations
  async createAlertRule(alertRuleData: Partial<AlertRule>): Promise<AlertRule> {
    const alertRule = this.alertRuleRepository.create(alertRuleData);
    return await this.alertRuleRepository.save(alertRule);
  }

  async getAlertRules(deviceId: string): Promise<AlertRule[]> {
    return await this.alertRuleRepository.find({
      where: { device_id: deviceId, enabled: true },
    });
  }

  async updateAlertRule(id: number, updateData: Partial<AlertRule>): Promise<AlertRule | null> {
    await this.alertRuleRepository.update(id, updateData);
    return await this.alertRuleRepository.findOne({ where: { id } });
  }

  async deleteAlertRule(id: number): Promise<void> {
    await this.alertRuleRepository.delete(id);
  }

  // Event log operations
  async insertEventLog(eventLogData: Partial<EventLog>): Promise<EventLog> {
    const eventLog = this.eventLogRepository.create(eventLogData);
    return await this.eventLogRepository.save(eventLog);
  }

  async getEventLogs(deviceId: string, limit: number = 100): Promise<EventLog[]> {
    return await this.eventLogRepository.find({
      where: { device_id: deviceId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async getEventLogsByType(deviceId: string, eventType: string, limit: number = 100): Promise<EventLog[]> {
    return await this.eventLogRepository.find({
      where: { device_id: deviceId, event_type: eventType },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async insertAlert(deviceId: string, alert: any): Promise<EventLog> {
    return await this.insertEventLog({
      device_id: deviceId,
      event_type: 'alert',
      message: alert.message,
      severity: alert.severity,
    });
  }

  // System operations
  async getSystemStats(): Promise<any> {
    const deviceCount = await this.deviceRepository.count();
    const alertRuleCount = await this.alertRuleRepository.count();
    const eventLogCount = await this.eventLogRepository.count();
    
    const recentEvents = await this.eventLogRepository.find({
      order: { timestamp: 'DESC' },
      take: 10,
    });

    return {
      deviceCount,
      alertRuleCount,
      eventLogCount,
      recentEvents,
    };
  }

  async cleanupOldEvents(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.eventLogRepository
      .createQueryBuilder()
      .delete()
      .where('timestamp < :cutoffDate', { cutoffDate })
      .execute();

    return result.affected || 0;
  }
} 