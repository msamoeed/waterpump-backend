import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Device } from './device.entity';

@Entity('alert_rules')
export class AlertRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  device_id: string;

  @Column()
  condition_type: string;

  @Column('decimal', { precision: 10, scale: 2 })
  threshold_value: number;

  @Column('text')
  alert_message: string;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Device, device => device.alert_rules)
  @JoinColumn({ name: 'device_id', referencedColumnName: 'device_id' })
  device: Device;
} 