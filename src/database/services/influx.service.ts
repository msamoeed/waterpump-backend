import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfluxDB, Point, WriteApi, QueryApi } from '@influxdata/influxdb-client';
import { DeviceStatusUpdateDto } from '../../common/dto/device-status-update.dto';

@Injectable()
export class InfluxService {
  private writeApi: WriteApi;
  private queryApi: QueryApi;

  constructor(private configService: ConfigService) {
    const client = new InfluxDB({
      url: this.configService.get('INFLUXDB_URL') || 'http://localhost:8086',
      token: this.configService.get('INFLUXDB_TOKEN') || 'your-token',
    });

    this.writeApi = client.getWriteApi(
      this.configService.get('INFLUXDB_ORG') || 'your-org',
      this.configService.get('INFLUXDB_BUCKET') || 'waterpump',
      'ns'
    );

    this.queryApi = client.getQueryApi(
      this.configService.get('INFLUXDB_ORG') || 'your-org'
    );
  }

  async writeWaterLevels(statusUpdate: DeviceStatusUpdateDto, timestamp: Date): Promise<void> {
    const points = [
      new Point('water_levels')
        .tag('device_id', statusUpdate.device_id)
        .tag('tank_id', 'ground')
        .floatField('level_percent', statusUpdate.ground_tank.level_percent)
        .floatField('level_inches', statusUpdate.ground_tank.level_inches)
        .booleanField('alarm_active', statusUpdate.ground_tank.alarm_active)
        .booleanField('connected', statusUpdate.ground_tank.connected)
        .booleanField('sensor_working', statusUpdate.ground_tank.sensor_working)
        .timestamp(timestamp),
      
      new Point('water_levels')
        .tag('device_id', statusUpdate.device_id)
        .tag('tank_id', 'roof')
        .floatField('level_percent', statusUpdate.roof_tank.level_percent)
        .floatField('level_inches', statusUpdate.roof_tank.level_inches)
        .booleanField('alarm_active', statusUpdate.roof_tank.alarm_active)
        .booleanField('connected', statusUpdate.roof_tank.connected)
        .booleanField('sensor_working', statusUpdate.roof_tank.sensor_working)
        .timestamp(timestamp),
    ];

    this.writeApi.writePoints(points);
    await this.writeApi.flush();
  }

  async writePumpMetrics(statusUpdate: DeviceStatusUpdateDto, timestamp: Date): Promise<void> {
    const point = new Point('pump_metrics')
      .tag('device_id', statusUpdate.device_id)
      .floatField('current_amps', statusUpdate.pump.current_amps)
      .floatField('power_watts', statusUpdate.pump.power_watts)
      .floatField('daily_consumption', statusUpdate.pump.daily_consumption)
      .floatField('hourly_consumption', statusUpdate.pump.hourly_consumption)
      .booleanField('running', statusUpdate.pump.running)
      .booleanField('protection_active', statusUpdate.pump.protection_active)
      .intField('runtime_minutes', statusUpdate.pump.runtime_minutes)
      .intField('total_runtime_hours', statusUpdate.pump.total_runtime_hours)
      .timestamp(timestamp);

    this.writeApi.writePoint(point);
    await this.writeApi.flush();
  }

  async writeSystemEvent(deviceId: string, eventType: string, description: string, severity: string, timestamp: Date): Promise<void> {
    const point = new Point('system_events')
      .tag('device_id', deviceId)
      .tag('event_type', eventType)
      .tag('severity', severity)
      .stringField('description', description)
      .timestamp(timestamp);

    this.writeApi.writePoint(point);
    await this.writeApi.flush();
  }

  async queryHistoricalData(
    deviceId: string,
    measurement: string,
    startTime: string,
    endTime: string,
    aggregateWindow?: string
  ): Promise<any[]> {
    const bucket = this.configService.get('INFLUXDB_BUCKET') || 'waterpump';
    
    // For now, let's use a simpler approach without aggregation to avoid boolean field issues
    // We'll get raw data and handle aggregation in the application layer if needed
    const fluxQuery = `
      from(bucket: "${bucket}")
        |> range(start: ${startTime}, stop: ${endTime})
        |> filter(fn: (r) => r._measurement == "${measurement}")
        |> filter(fn: (r) => r.device_id == "${deviceId}")
        |> sort(columns: ["_time"])
        |> yield(name: "raw_data")
    `;

    const result = [];
    await this.queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const record = tableMeta.toObject(row);
        result.push(record);
      },
      error(error) {
        console.error('InfluxDB query error:', error);
        throw error;
      },
      complete() {
        // Query completed successfully
      }
    });

    return result;
  }

  async getLatestDeviceData(deviceId: string): Promise<any> {
    const bucket = this.configService.get('INFLUXDB_BUCKET') || 'waterpump';
    const fluxQuery = `
      from(bucket: "${bucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r.device_id == "${deviceId}")
        |> last()
    `;

    const result = [];
    await this.queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const record = tableMeta.toObject(row);
        result.push(record);
      },
      error(error) {
        console.error('InfluxDB query error:', error);
        throw error;
      },
      complete() {
        // Query completed successfully
      }
    });

    return result;
  }
} 