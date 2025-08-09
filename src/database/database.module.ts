import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from './entities/device.entity';
import { AlertRule } from './entities/alert-rule.entity';
import { EventLog } from './entities/event-log.entity';
import { MotorState } from './entities/motor-state.entity';
import { InfluxService } from './services/influx.service';
import { RedisService } from './services/redis.service';
import { PostgresService } from './services/postgres.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST') || 'localhost',
        port: configService.get('POSTGRES_PORT') || 5432,
        username: configService.get('POSTGRES_USER') || 'postgres',
        password: configService.get('POSTGRES_PASSWORD') || 'password',
        database: configService.get('POSTGRES_DB') || 'waterpump',
        entities: [Device, AlertRule, EventLog, MotorState],
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: configService.get('NODE_ENV') === 'development',
        ssl: false, // Disable SSL for all environments
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Device, AlertRule, EventLog, MotorState]),
  ],
  providers: [
    InfluxService,
    RedisService,
    PostgresService,
  ],
  exports: [
    TypeOrmModule,
    InfluxService,
    RedisService,
    PostgresService,
  ],
})
export class DatabaseModule {} 