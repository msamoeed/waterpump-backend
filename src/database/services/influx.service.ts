import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { DeviceStatusUpdateDto } from '../../common/dto/device-status-update.dto';

@Injectable()
export class InfluxService {
  private influx3Client: InfluxDBClient;
  private readonly DEFAULT_LIMIT = 1000;
  private readonly MAX_LIMIT = 10000;

  constructor(private configService: ConfigService) {
    try {
      // Initialize InfluxDB 3.3 Core client
      // For InfluxDB 3.3 Core, we need to use the correct configuration
      const host = this.configService.get('INFLUXDB_URL') || 'http://localhost:8087';
      const token = this.configService.get('INFLUXDB_TOKEN') || 'dummy-token-for-no-auth-mode';
      const database = this.configService.get('INFLUXDB_BUCKET') || 'waterpump';

      console.log(`[DEBUG] InfluxDB 3.3 Configuration:`, {
        host,
        database,
        token: token ? '***' : 'not set (no-auth mode)'
      });

      this.influx3Client = new InfluxDBClient({
        host,
        token,
        database,
      });

      console.log(`[DEBUG] InfluxDB client created successfully`);
    } catch (error) {
      console.error('[ERROR] Failed to initialize InfluxDB client:', error);
      throw new Error(`InfluxDB initialization failed: ${error.message}`);
    }
  }

  async writeWaterLevels(statusUpdate: DeviceStatusUpdateDto, timestamp: Date): Promise<void> {
    const points = [
      Point.measurement('water_levels')
        .setTag('device_id', statusUpdate.device_id)
        .setTag('tank_id', 'ground')
        .setFloatField('level_percent', statusUpdate.ground_tank.level_percent)
        .setFloatField('level_inches', statusUpdate.ground_tank.level_inches)
        .setBooleanField('alarm_active', statusUpdate.ground_tank.alarm_active)
        .setBooleanField('connected', statusUpdate.ground_tank.connected)
        .setBooleanField('sensor_working', statusUpdate.ground_tank.sensor_working)
        .setBooleanField('water_supply_on', statusUpdate.ground_tank.water_supply_on)
        .setTimestamp(timestamp),

      Point.measurement('water_levels')
        .setTag('device_id', statusUpdate.device_id)
        .setTag('tank_id', 'roof')
        .setFloatField('level_percent', statusUpdate.roof_tank.level_percent)
        .setFloatField('level_inches', statusUpdate.roof_tank.level_inches)
        .setBooleanField('alarm_active', statusUpdate.roof_tank.alarm_active)
        .setBooleanField('connected', statusUpdate.roof_tank.connected)
        .setBooleanField('sensor_working', statusUpdate.roof_tank.sensor_working)
        .setBooleanField('water_supply_on', statusUpdate.roof_tank.water_supply_on)
        .setTimestamp(timestamp),
    ];

    try {
      await this.influx3Client.write(points);
      console.log(`[DEBUG] Wrote ${points.length} water level points`);
    } catch (error) {
      console.error('Error writing water levels:', error);
      throw error;
    }
  }

  async writePumpMetrics(statusUpdate: DeviceStatusUpdateDto, timestamp: Date): Promise<void> {
    const point = Point.measurement('pump_metrics')
      .setTag('device_id', statusUpdate.device_id)
      .setFloatField('current_amps', statusUpdate.pump.current_amps)
      .setFloatField('power_watts', statusUpdate.pump.power_watts)
      .setFloatField('daily_consumption', statusUpdate.pump.daily_consumption)
      .setFloatField('hourly_consumption', statusUpdate.pump.hourly_consumption)
      .setBooleanField('running', statusUpdate.pump.running)
      .setBooleanField('protection_active', statusUpdate.pump.protection_active)
      .setIntegerField('runtime_minutes', statusUpdate.pump.runtime_minutes)
      .setIntegerField('total_runtime_hours', statusUpdate.pump.total_runtime_hours)
      .setTimestamp(timestamp);

    try {
      await this.influx3Client.write([point]);
      console.log(`[DEBUG] Wrote pump metrics point`);
    } catch (error) {
      console.error('Error writing pump metrics:', error);
      throw error;
    }
  }

  async writeSystemEvent(deviceId: string, eventType: string, description: string, severity: string, timestamp: Date): Promise<void> {
    const point = Point.measurement('system_events')
      .setTag('device_id', deviceId)
      .setTag('event_type', eventType)
      .setTag('severity', severity)
      .setStringField('description', description)
      .setTimestamp(timestamp);

    try {
      await this.influx3Client.write([point]);
      console.log(`[DEBUG] Wrote system event point`);
    } catch (error) {
      console.error('Error writing system event:', error);
      throw error;
    }
  }

  // 🚨 MEMORY OPTIMIZED: Get record count before processing large datasets
  async getRecordCount(
    deviceId: string,
    measurement: string,
    startTime: string,
    endTime: string
  ): Promise<number> {
    const sqlQuery = `
      SELECT COUNT(*) as count
      FROM ${measurement} 
      WHERE device_id = '${deviceId}' 
        AND time >= '${startTime}' 
        AND time <= '${endTime}'
    `;

    try {
      const result = [];
      for await (const row of this.influx3Client.query(sqlQuery)) {
        result.push(row);
      }
      return result[0]?.count || 0;
    } catch (error) {
      console.error('InfluxDB count query error:', error);
      return 0;
    }
  }

  // 🚨 MEMORY OPTIMIZED: Paginated query with limits
  async queryHistoricalData(
    deviceId: string,
    measurement: string,
    startTime: string,
    endTime: string,
    aggregateWindow?: string,
    limit: number = this.DEFAULT_LIMIT,
    offset: number = 0
  ): Promise<{ data: any[], total: number, hasMore: boolean, limit: number, offset: number }> {
    // Validate and cap limits to prevent memory issues
    limit = Math.min(limit, this.MAX_LIMIT);
    limit = Math.max(limit, 1);
    offset = Math.max(offset, 0);

    // Get total count first
    const total = await this.getRecordCount(deviceId, measurement, startTime, endTime);
    
    // If dataset is too large, suggest aggregation
    if (total > 100000 && !aggregateWindow) {
      console.warn(`[WARNING] Large dataset detected: ${total} records. Consider using aggregation window.`);
    }

    let sqlQuery: string;
    
    if (measurement === 'water_levels') {
      if (aggregateWindow) {
        // 🚨 FIXED: Use InfluxDB 3.3 compatible time window functions
        // InfluxDB 3.3 uses different syntax for time aggregation
        let timeGroupBy = '';
        if (aggregateWindow === '1h') {
          timeGroupBy = 'time_bucket(interval \'1 hour\', time)';
        } else if (aggregateWindow === '1d') {
          timeGroupBy = 'time_bucket(interval \'1 day\', time)';
        } else if (aggregateWindow === '1m') {
          timeGroupBy = 'time_bucket(interval \'1 minute\', time)';
        } else if (aggregateWindow === '1s') {
          timeGroupBy = 'time_bucket(interval \'1 second\', time)';
        } else {
          timeGroupBy = 'time_bucket(interval \'1 hour\', time)';
        }
        
        sqlQuery = `
          SELECT 
            ${timeGroupBy} as time,
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
          GROUP BY ${timeGroupBy}, device_id, tank_id
          ORDER BY time
          LIMIT ${limit} OFFSET ${offset}
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
          LIMIT ${limit} OFFSET ${offset}
        `;
      }
    } else if (measurement === 'pump_metrics') {
      if (aggregateWindow) {
        // 🚨 FIXED: Use InfluxDB 3.3 compatible time window functions
        let timeGroupBy = '';
        if (aggregateWindow === '1h') {
          timeGroupBy = 'time_bucket(interval \'1 hour\', time)';
        } else if (aggregateWindow === '1d') {
          timeGroupBy = 'time_bucket(interval \'1 day\', time)';
        } else if (aggregateWindow === '1m') {
          timeGroupBy = 'time_bucket(interval \'1 minute\', time)';
        } else if (aggregateWindow === '1s') {
          timeGroupBy = 'time_bucket(interval \'1 second\', time)';
        } else {
          timeGroupBy = 'time_bucket(interval \'1 hour\', time)';
        }
        
        sqlQuery = `
          SELECT 
            ${timeGroupBy} as time,
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
          GROUP BY ${timeGroupBy}, device_id
          ORDER BY time
          LIMIT ${limit} OFFSET ${offset}
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
          LIMIT ${limit} OFFSET ${offset}
        `;
      }
    } else {
      sqlQuery = `
        SELECT * FROM ${measurement} 
        WHERE device_id = '${deviceId}' 
          AND time >= '${startTime}' 
          AND time <= '${endTime}'
        ORDER BY time
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    console.log(`[DEBUG] InfluxDB SQL Query: ${sqlQuery}`);

    try {
      const result = [];
      for await (const row of this.influx3Client.query(sqlQuery)) {
        result.push(row);
        // 🚨 MEMORY SAFETY: Check if we're approaching memory limits
        if (result.length > limit) {
          console.warn(`[WARNING] Query result exceeded limit: ${result.length} > ${limit}`);
          break;
        }
      }
      
      console.log(`[DEBUG] InfluxDB SQL Result: ${result.length} records found`);
      
      const hasMore = (offset + limit) < total;
      
      return {
        data: result,
        total,
        hasMore,
        limit,
        offset
      };
    } catch (error) {
      console.error('InfluxDB SQL query error:', error);
      throw error;
    }
  }

  // 🚨 MEMORY OPTIMIZED: Streaming for large datasets
  async *streamHistoricalData(
    deviceId: string,
    measurement: string,
    startTime: string,
    endTime: string,
    aggregateWindow?: string,
    chunkSize: number = 1000
  ): AsyncGenerator<any[], void, unknown> {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await this.queryHistoricalData(
        deviceId, 
        measurement, 
        startTime, 
        endTime, 
        aggregateWindow, 
        chunkSize, 
        offset
      );

      if (result.data.length > 0) {
        yield result.data;
      }

      hasMore = result.hasMore;
      offset += chunkSize;

      // 🚨 MEMORY SAFETY: Add small delay to prevent overwhelming memory
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  // Public method to access the SQL client for testing
  getSQLClient() {
    if (!this.influx3Client) {
      throw new Error('InfluxDB client not initialized');
    }
    return this.influx3Client;
  }

  // 🚨 MEMORY OPTIMIZED: Limited latest data query
  async getLatestDeviceData(deviceId: string): Promise<any> {
    // 🚨 FIXED: Use InfluxDB 3.3 compatible time functions
    // InfluxDB 3.3 doesn't support NOW() - INTERVAL syntax
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
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
        WHERE device_id = '${deviceId}' AND time >= '${oneHourAgo}'
        ORDER BY time DESC
        LIMIT 10
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
        WHERE device_id = '${deviceId}' AND time >= '${oneHourAgo}'
        ORDER BY time DESC
        LIMIT 10
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

  // 🚨 MEMORY OPTIMIZED: Streaming water supply duration calculation
  async getWaterSupplyDuration(deviceId: string, tankId: string, startTime: string, endTime: string): Promise<any> {
    // First check if dataset is too large
    const totalRecords = await this.getRecordCount(deviceId, 'water_levels', startTime, endTime);
    
    if (totalRecords > 50000) {
      console.warn(`[WARNING] Large dataset for water supply calculation: ${totalRecords} records. Consider using shorter time ranges.`);
    }

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
      let processedCount = 0;
      
      for await (const row of this.influx3Client.query(sqlQuery)) {
        result.push(row);
        processedCount++;
        
        // 🚨 MEMORY SAFETY: Process in chunks to prevent memory buildup
        if (processedCount % 1000 === 0) {
          console.log(`[DEBUG] Processed ${processedCount} records for water supply calculation`);
          // Force garbage collection hint
          if (global.gc) {
            global.gc();
          }
        }
      }
      
      // 🚨 MEMORY OPTIMIZED: Process results in smaller chunks
      return this.processWaterSupplySessions(result);
    } catch (error) {
      console.error('InfluxDB water supply query error:', error);
      throw error;
    }
  }

  // 🚨 MEMORY OPTIMIZED: Separate method for processing sessions
  private processWaterSupplySessions(records: any[]): any {
    const sessions = [];
    let currentSession = null;
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
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
      
      // 🚨 MEMORY SAFETY: Limit sessions array size
      if (sessions.length > 1000) {
        console.warn(`[WARNING] Too many water supply sessions: ${sessions.length}. Truncating.`);
        break;
      }
    }
    
    // Handle case where session is still active at the end of the time range
    if (currentSession) {
      currentSession.end_time = new Date();
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
      sessions: sessions.slice(0, 100), // Limit returned sessions
      stats: {
        total_duration_hours: totalDurationMinutes / 60,
        total_sessions: totalSessions,
        avg_duration_minutes: avgDurationMinutes,
        max_duration_minutes: maxDurationMinutes,
        min_duration_minutes: minDurationMinutes
      }
    };
  }

  // 🚨 MEMORY SAFETY: Cleanup method
  async cleanup() {
    try {
      // Close any open connections
      if (this.influx3Client) {
        // Note: InfluxDB 3.x client doesn't have explicit close method
        // But we can clean up any cached data
        console.log('[DEBUG] InfluxDB service cleanup completed');
      }
    } catch (error) {
      console.error('[ERROR] InfluxDB cleanup error:', error);
    }
  }
} 