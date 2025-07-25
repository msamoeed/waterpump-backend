import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { AlertRule } from './alert-rule.entity';
import { EventLog } from './event-log.entity';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  device_id: string;

  @Column()
  name: string;

  @Column('text', { nullable: true })
  location: string;

  @Column('int', { nullable: true })
  tank_capacity_liters: number;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  pump_max_current: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => AlertRule, alertRule => alertRule.device)
  alert_rules: AlertRule[];

  @OneToMany(() => EventLog, eventLog => eventLog.device)
  event_logs: EventLog[];
} 