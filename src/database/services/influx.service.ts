import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { InfluxDBClient } from '@influxdata/influxdb3-client';
import { DeviceStatusUpdateDto } from '../../common/dto/device-status-update.dto';

@Injectable()
export class InfluxService {
  private writeApi: any;
  private queryApi: any;
  private influx3Client: InfluxDBClient;

  constructor(private configService: ConfigService) {
    // Initialize the old client for writing (keeping compatibility)
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

    // Initialize the new InfluxDB 3.0 client for SQL queries
    this.influx3Client = new InfluxDBClient({
      host: this.configService.get('INFLUXDB_URL') || 'http://localhost:8086',
      token: this.configService.get('INFLUXDB_TOKEN') || 'your-token',
      database: this.configService.get('INFLUXDB_BUCKET') || 'waterpump',
    });
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
    let sqlQuery: string;
    
    if (measurement === 'water_levels') {
      if (aggregateWindow) {
        // Convert InfluxDB 2.x time units to InfluxDB 3.x DATE_TRUNC units
        const timeUnit = aggregateWindow === '1h' ? 'hour' : 
                        aggregateWindow === '1d' ? 'day' : 
                        aggregateWindow === '1m' ? 'minute' : 
                        aggregateWindow === '1s' ? 'second' : 'hour';
        
        // Use window function for aggregation
        sqlQuery = `
          SELECT 
            DATE_TRUNC('${timeUnit}', time) as time,
            device_id,
            tank_id,
            AVG(level_percent) as level_percent,
            AVG(level_inches) as level_inches,
            MAX(CASE WHEN alarm_active THEN 1 ELSE 0 END) as alarm_active,
            MAX(CASE WHEN connected THEN 1 ELSE 0 END) as connected,
            MAX(CASE WHEN sensor_working THEN 1 ELSE 0 END) as sensor_working,
            MAX(CASE WHEN water_supply_on THEN 1 ELSE 0 END) as water_supply_on
          FROM water_levels 
          WHERE device_id = '${deviceId}' 
            AND tank_id IN ('ground', 'roof')
            AND time >= '${startTime}' 
            AND time <= '${endTime}'
          GROUP BY DATE_TRUNC('${timeUnit}', time), device_id, tank_id
          ORDER BY time
        `;
      } else {
        sqlQuery = `
          SELECT 
            time,
            device_id,
            tank_id,
            level_percent,
            level_inches,
            alarm_active,
            connected,
            sensor_working,
            water_supply_on
          FROM water_levels 
          WHERE device_id = '${deviceId}' 
            AND tank_id IN ('ground', 'roof')
            AND time >= '${startTime}' 
            AND time <= '${endTime}'
          ORDER BY time
        `;
      }
    } else if (measurement === 'pump_metrics') {
      if (aggregateWindow) {
        // Convert InfluxDB 2.x time units to InfluxDB 3.x DATE_TRUNC units
        const timeUnit = aggregateWindow === '1h' ? 'hour' : 
                        aggregateWindow === '1d' ? 'day' : 
                        aggregateWindow === '1m' ? 'minute' : 
                        aggregateWindow === '1s' ? 'second' : 'hour';
        
        sqlQuery = `
          SELECT 
            DATE_TRUNC('${timeUnit}', time) as time,
            device_id,
            AVG(current_amps) as current_amps,
            AVG(power_watts) as power_watts,
            MAX(CASE WHEN running THEN 1 ELSE 0 END) as running,
            MAX(CASE WHEN protection_active THEN 1 ELSE 0 END) as protection_active,
            AVG(runtime_minutes) as runtime_minutes,
            AVG(total_runtime_hours) as total_runtime_hours
          FROM pump_metrics 
          WHERE device_id = '${deviceId}' 
            AND time >= '${startTime}' 
            AND time <= '${endTime}'
          GROUP BY DATE_TRUNC('${timeUnit}', time), device_id
          ORDER BY time
        `;
      } else {
        sqlQuery = `
          SELECT 
            time,
            device_id,
            current_amps,
            power_watts,
            running,
            protection_active,
            runtime_minutes,
            total_runtime_hours
          FROM pump_metrics 
          WHERE device_id = '${deviceId}' 
            AND time >= '${startTime}' 
            AND time <= '${endTime}'
          ORDER BY time
        `;
      }
    } else {
      // For other measurements, use simple query
      sqlQuery = `
        SELECT * FROM ${measurement} 
        WHERE device_id = '${deviceId}' 
          AND time >= '${startTime}' 
          AND time <= '${endTime}'
        ORDER BY time
      `;
    }

    console.log(`[DEBUG] InfluxDB SQL Query: ${sqlQuery}`);

    try {
      const result = [];
      for await (const row of this.influx3Client.query(sqlQuery)) {
        result.push(row);
      }
      console.log(`[DEBUG] InfluxDB SQL Result: ${result.length} records found`);
      return result;
    } catch (error) {
      console.error('InfluxDB SQL query error:', error);
      throw error;
    }
  }



  // Public method to access the SQL client for testing
  getSQLClient() {
    return this.influx3Client;
  }

  async getLatestDeviceData(deviceId: string): Promise<any> {
    const sqlQuery = `
      SELECT 
        time,
        device_id,
        tank_id,
        level_percent,
        level_inches,
        current_amps,
        power_watts,
        running
      FROM (
        SELECT 
          time,
          device_id,
          tank_id,
          level_percent,
          level_inches,
          NULL as current_amps,
          NULL as power_watts,
          NULL as running
        FROM water_levels 
        WHERE device_id = '${deviceId}' AND time >= NOW() - INTERVAL '1 hour'
        UNION ALL
        SELECT 
          time,
          device_id,
          NULL as tank_id,
          NULL as level_percent,
          NULL as level_inches,
          current_amps,
          power_watts,
          running
        FROM pump_metrics 
        WHERE device_id = '${deviceId}' AND time >= NOW() - INTERVAL '1 hour'
      ) combined_data
      ORDER BY time DESC
      LIMIT 1
    `;

    try {
      const result = [];
      for await (const row of this.influx3Client.query(sqlQuery)) {
        result.push(row);
      }
      return result;
    } catch (error) {
      console.error('InfluxDB latest data query error:', error);
      throw error;
    }
  }



  async getWaterSupplyDuration(deviceId: string, tankId: string, startTime: string, endTime: string): Promise<any> {
    const sqlQuery = `
      SELECT 
        time,
        device_id,
        tank_id,
        water_supply_on
      FROM water_levels 
      WHERE device_id = '${deviceId}' 
        AND tank_id = '${tankId}'
        AND time >= '${startTime}' 
        AND time <= '${endTime}'
      ORDER BY time
    `;

    try {
      const result = [];
      for await (const row of this.influx3Client.query(sqlQuery)) {
        result.push(row);
      }
      
      // Process the results to calculate durations
      const sessions = [];
      let currentSession = null;
      
      for (let i = 0; i < result.length; i++) {
        const record = result[i];
        const isSupplyOn = record.water_supply_on === true;
        const timestamp = new Date(record.time);
        
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
    } catch (error) {
      console.error('InfluxDB water supply query error:', error);
      throw error;
    }
  }


} 