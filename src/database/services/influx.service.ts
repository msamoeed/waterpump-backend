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
        .booleanField('water_supply_on', statusUpdate.ground_tank.water_supply_on)
        .timestamp(timestamp),

      new Point('water_levels')
        .tag('device_id', statusUpdate.device_id)
        .tag('tank_id', 'roof')
        .floatField('level_percent', statusUpdate.roof_tank.level_percent)
        .floatField('level_inches', statusUpdate.roof_tank.level_inches)
        .booleanField('alarm_active', statusUpdate.roof_tank.alarm_active)
        .booleanField('connected', statusUpdate.roof_tank.connected)
        .booleanField('sensor_working', statusUpdate.roof_tank.sensor_working)
        .booleanField('water_supply_on', statusUpdate.roof_tank.water_supply_on)
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
    
    // Use the same query structure as the working InfluxDB UI query
    let fluxQuery: string;
    
    if (measurement === 'water_levels') {
      fluxQuery = `
        from(bucket: "${bucket}")
          |> range(start: ${startTime}, stop: ${endTime})
          |> filter(fn: (r) => r["_measurement"] == "water_levels")
          |> filter(fn: (r) => r["_field"] == "level_percent" or r["_field"] == "level_inches")
          |> filter(fn: (r) => r["device_id"] == "${deviceId}")
          |> filter(fn: (r) => r["tank_id"] == "ground" or r["tank_id"] == "roof")
          ${aggregateWindow ? `|> aggregateWindow(every: ${aggregateWindow}, fn: mean, createEmpty: false)` : ''}
          |> yield(name: "mean")
      `;
    } else if (measurement === 'pump_metrics') {
      // For pump metrics, only aggregate numeric fields
      fluxQuery = `
        from(bucket: "${bucket}")
          |> range(start: ${startTime}, stop: ${endTime})
          |> filter(fn: (r) => r["_measurement"] == "pump_metrics")
          |> filter(fn: (r) => r["_field"] == "current_amps" or r["_field"] == "power_watts" or r["_field"] == "running")
          |> filter(fn: (r) => r["device_id"] == "${deviceId}")
          ${aggregateWindow ? `|> aggregateWindow(every: ${aggregateWindow}, fn: mean, createEmpty: false)` : ''}
          |> yield(name: "mean")
      `;
    } else {
      // For other measurements, use simple query
      fluxQuery = `
        from(bucket: "${bucket}")
          |> range(start: ${startTime}, stop: ${endTime})
          |> filter(fn: (r) => r._measurement == "${measurement}")
          |> filter(fn: (r) => r.device_id == "${deviceId}")
          |> sort(columns: ["_time"])
          |> yield(name: "raw_data")
      `;
    }

    console.log(`[DEBUG] InfluxDB Query: ${fluxQuery}`);

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

    console.log(`[DEBUG] InfluxDB Result: ${result.length} records found`);
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

  async getWaterSupplyDuration(deviceId: string, tankId: string, startTime: string, endTime: string): Promise<any> {
    const bucket = this.configService.get('INFLUXDB_BUCKET') || 'waterpump';
    
    // Query to get water supply state changes
    const fluxQuery = `
      from(bucket: "${bucket}")
        |> range(start: ${startTime}, stop: ${endTime})
        |> filter(fn: (r) => r["_measurement"] == "water_levels")
        |> filter(fn: (r) => r["_field"] == "water_supply_on")
        |> filter(fn: (r) => r["device_id"] == "${deviceId}")
        |> filter(fn: (r) => r["tank_id"] == "${tankId}")
        |> sort(columns: ["_time"])
    `;

    const results: any[] = [];
    
    const result = [];
    await this.queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const record = tableMeta.toObject(row);
        result.push(record);
      },
      error(error) {
        console.error('InfluxDB water supply query error:', error);
        throw error;
      },
      complete() {
        // Query completed successfully
      }
    });

    // Process the results to calculate durations
    const sessions = [];
    let currentSession = null;
    
    for (let i = 0; i < result.length; i++) {
      const record = result[i];
      const isSupplyOn = record._value === true;
      const timestamp = new Date(record._time);
      
      if (isSupplyOn && !currentSession) {
        // Start of a new session
        currentSession = {
          start_time: timestamp,
          end_time: null,
          duration_minutes: 0
        };
      } else if (!isSupplyOn && currentSession) {
        // End of current session
        currentSession.end_time = timestamp;
        currentSession.duration_minutes = Math.floor(
          (timestamp.getTime() - currentSession.start_time.getTime()) / (1000 * 60)
        );
        sessions.push(currentSession);
        currentSession = null;
      }
    }
    
    // Handle case where session is still active at the end of the time range
    if (currentSession) {
      currentSession.end_time = new Date(endTime);
      currentSession.duration_minutes = Math.floor(
        (currentSession.end_time.getTime() - currentSession.start_time.getTime()) / (1000 * 60)
      );
      sessions.push(currentSession);
    }
    
    // Calculate statistics
    const totalDurationMinutes = sessions.reduce((sum, session) => sum + session.duration_minutes, 0);
    const totalSessions = sessions.length;
    const avgDurationMinutes = totalSessions > 0 ? totalDurationMinutes / totalSessions : 0;
    const maxDurationMinutes = totalSessions > 0 ? Math.max(...sessions.map(s => s.duration_minutes)) : 0;
    const minDurationMinutes = totalSessions > 0 ? Math.min(...sessions.map(s => s.duration_minutes)) : 0;
    
    return {
      sessions: sessions,
      stats: {
        total_duration_hours: totalDurationMinutes / 60,
        total_sessions: totalSessions,
        avg_duration_minutes: avgDurationMinutes,
        max_duration_minutes: maxDurationMinutes,
        min_duration_minutes: minDurationMinutes
      }
    };
  }
} 