import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Device } from './device.entity';

@Entity('event_log')
export class EventLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  device_id: string;

  @Column()
  event_type: string;

  @Column('text')
  message: string;

  @Column()
  severity: string;

  @CreateDateColumn()
  timestamp: Date;

  @ManyToOne(() => Device, device => device.event_logs)
  @JoinColumn({ name: 'device_id', referencedColumnName: 'device_id' })
  device: Device;
} 