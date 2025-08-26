import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { DeviceStatusUpdateDto } from '../../common/dto/device-status-update.dto';

@Injectable()
export class InfluxService {
  private influx3Client: InfluxDBClient;
  private readonly MAX_FILE_LIMIT = process.env.INFLUXDB_MAX_FILE_LIMIT ? parseInt(process.env.INFLUXDB_MAX_FILE_LIMIT) : 1000;
  private readonly DEFAULT_CHUNK_SIZE_HOURS = process.env.INFLUXDB_CHUNK_SIZE_HOURS ? parseInt(process.env.INFLUXDB_CHUNK_SIZE_HOURS) : 6;

  constructor(private configService: ConfigService) {
    this.initializeClient();
  }

  private async initializeClient() {
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

  async queryHistoricalData(
    deviceId: string,
    measurement: string,
    startTime: string,
    endTime: string,
    aggregateWindow?: string
  ): Promise<any[]> {
    // Parse time strings to Date objects
    const start = new Date(startTime);
    const end = new Date(endTime);
    const timeRangeMs = end.getTime() - start.getTime();
    
    // If time range is larger than 6 hours, chunk it into smaller segments
    const MAX_TIME_RANGE_MS = 6 * 60 * 60 * 1000; // 6 hours
    
    if (timeRangeMs > MAX_TIME_RANGE_MS) {
      console.log(`[DEBUG] Large time range detected (${timeRangeMs / (60 * 60 * 1000)} hours), chunking into smaller segments`);
      return this.queryHistoricalDataChunked(deviceId, measurement, startTime, endTime, aggregateWindow);
    }
    
    return this.executeHistoricalDataQuery(deviceId, measurement, startTime, endTime, aggregateWindow);
  }

  private async queryHistoricalDataChunked(
    deviceId: string,
    measurement: string,
    startTime: string,
    endTime: string,
    aggregateWindow?: string
  ): Promise<any[]> {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const chunkSizeMs = this.DEFAULT_CHUNK_SIZE_HOURS * 60 * 60 * 1000; // Use configured chunk size
    
    const results: any[] = [];
    let currentStart = start;
    
    console.log(`[DEBUG] Chunking query into ${this.DEFAULT_CHUNK_SIZE_HOURS}-hour segments`);
    
    while (currentStart < end) {
      const currentEnd = new Date(Math.min(currentStart.getTime() + chunkSizeMs, end.getTime()));
      
      console.log(`[DEBUG] Querying chunk: ${currentStart.toISOString()} to ${currentEnd.toISOString()}`);
      
      try {
        const chunkResult = await this.executeHistoricalDataQuery(
          deviceId,
          measurement,
          currentStart.toISOString(),
          currentEnd.toISOString(),
          aggregateWindow
        );
        
        results.push(...chunkResult);
        console.log(`[DEBUG] Chunk result: ${chunkResult.length} records`);
        
      } catch (error) {
        if (this.isFileLimitError(error)) {
          // If still hitting file limit, reduce chunk size further
          console.log(`[DEBUG] File limit hit, reducing chunk size for this segment`);
          const smallerChunkSizeMs = chunkSizeMs / 2; // Half the configured chunk size
          const smallerEnd = new Date(Math.min(currentStart.getTime() + smallerChunkSizeMs, end.getTime()));
          
          try {
            const smallerChunkResult = await this.executeHistoricalDataQuery(
              deviceId,
              measurement,
              currentStart.toISOString(),
              smallerEnd.toISOString(),
              aggregateWindow
            );
            
            results.push(...smallerChunkResult);
            console.log(`[DEBUG] Smaller chunk result: ${smallerChunkResult.length} records`);
            currentStart = smallerEnd;
          } catch (smallerError) {
            console.error(`[ERROR] Failed to query smaller chunk:`, smallerError);
            // If even smaller chunks fail, try with 1-hour chunks
            const oneHourChunkSizeMs = 60 * 60 * 1000; // 1 hour
            const oneHourEnd = new Date(Math.min(currentStart.getTime() + oneHourChunkSizeMs, end.getTime()));
            
            try {
              const oneHourResult = await this.executeHistoricalDataQuery(
                deviceId,
                measurement,
                currentStart.toISOString(),
                oneHourEnd.toISOString(),
                aggregateWindow
              );
              
              results.push(...oneHourResult);
              console.log(`[DEBUG] One hour chunk result: ${oneHourResult.length} records`);
              currentStart = oneHourEnd;
            } catch (oneHourError) {
              console.error(`[ERROR] Failed to query one hour chunk:`, oneHourError);
              // Skip this problematic time range and continue
              currentStart = oneHourEnd;
            }
          }
        } else {
          console.error(`[ERROR] Failed to query chunk:`, error);
          // Skip this problematic time range and continue
          currentStart = currentEnd;
        }
      }
      
      currentStart = currentEnd;
    }
    
    console.log(`[DEBUG] Total results from chunked query: ${results.length} records`);
    return results;
  }

  private async executeHistoricalDataQuery(
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
      
      // Check if it's a file limit error
      if (this.isFileLimitError(error)) {
        const timeRange = this.calculateTimeRange(startTime, endTime);
        const suggestion = this.getFileLimitSuggestion(timeRange);
        
        const enhancedError = new Error(
          `Query exceeded file limit. ${suggestion} Original error: ${error.message}`
        );
        enhancedError.name = 'FileLimitError';
        enhancedError['originalError'] = error;
        enhancedError['timeRange'] = timeRange;
        enhancedError['suggestion'] = suggestion;
        
        throw enhancedError;
      }
      
      throw error;
    }
  }

  private isFileLimitError(error: any): boolean {
    return error.message && (
      error.message.includes('file limit') ||
      error.message.includes('Query would exceed file limit') ||
      error.message.includes('parquet files')
    );
  }

  private calculateTimeRange(startTime: string, endTime: string): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60); // hours
  }

  private getFileLimitSuggestion(timeRangeHours: number): string {
    if (timeRangeHours > 24) {
      return `Time range is ${timeRangeHours.toFixed(1)} hours. Consider reducing to 6 hours or less.`;
    } else if (timeRangeHours > 6) {
      return `Time range is ${timeRangeHours.toFixed(1)} hours. Consider reducing to 6 hours or less.`;
    } else {
      return `Time range is ${timeRangeHours.toFixed(1)} hours. This should work, but if issues persist, try reducing further.`;
    }
  }

  /**
   * Get recommended time range limits for different query types
   */
  getRecommendedTimeLimits(): { [key: string]: number } {
    return {
      'real-time': 1, // 1 hour for real-time data
      'daily': 6,     // 6 hours for daily analysis
      'weekly': 24,   // 24 hours for weekly analysis
      'monthly': 72,  // 72 hours for monthly analysis
      'custom': this.DEFAULT_CHUNK_SIZE_HOURS
    };
  }

  /**
   * Validate time range before querying
   */
  validateTimeRange(startTime: string, endTime: string, queryType: string = 'custom'): { valid: boolean; message?: string; suggestedRange?: { start: string; end: string } } {
    const limits = this.getRecommendedTimeLimits();
    const timeRangeHours = this.calculateTimeRange(startTime, endTime);
    const maxHours = limits[queryType] || limits.custom;
    
    if (timeRangeHours > maxHours) {
      const end = new Date(endTime);
      const suggestedStart = new Date(end.getTime() - (maxHours * 60 * 60 * 1000));
      
      return {
        valid: false,
        message: `Time range ${timeRangeHours.toFixed(1)} hours exceeds recommended limit of ${maxHours} hours for ${queryType} queries.`,
        suggestedRange: {
          start: suggestedStart.toISOString(),
          end: endTime
        }
      };
    }
    
    return { valid: true };
  }

  /**
   * Test different time ranges to find optimal configuration
   */
  async testTimeRangePerformance(
    deviceId: string,
    measurement: string,
    maxHours: number = 24
  ): Promise<{ [key: string]: any }> {
    const results: { [key: string]: any } = {};
    const endTime = new Date().toISOString();
    
    // Test different time ranges
    const testRanges = [1, 2, 4, 6, 12, 24].filter(h => h <= maxHours);
    
    for (const hours of testRanges) {
      const startTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      
      try {
        console.log(`[DEBUG] Testing ${hours}-hour range...`);
        const start = Date.now();
        
        const data = await this.executeHistoricalDataQuery(
          deviceId,
          measurement,
          startTime,
          endTime
        );
        
        const duration = Date.now() - start;
        
        results[`${hours}h`] = {
          success: true,
          startTime,
          endTime,
          recordCount: data.length,
          durationMs: duration,
          performance: duration < 1000 ? 'excellent' : 
                     duration < 3000 ? 'good' : 
                     duration < 10000 ? 'acceptable' : 'slow'
        };
        
      } catch (error) {
        results[`${hours}h`] = {
          success: false,
          startTime,
          endTime,
          error: error.message,
          isFileLimitError: this.isFileLimitError(error)
        };
      }
    }
    
    // Find the optimal range
    const successfulRanges = Object.entries(results)
      .filter(([_, result]) => result.success)
      .sort(([_, a], [__, b]) => a.durationMs - b.durationMs);
    
    if (successfulRanges.length > 0) {
      const [optimalRange, optimalResult] = successfulRanges[0];
      results.recommendation = {
        optimalRange,
        reason: `Fastest successful query: ${optimalResult.durationMs}ms`,
        maxSafeRange: successfulRanges[successfulRanges.length - 1][0]
      };
    } else {
      results.recommendation = {
        optimalRange: '1h',
        reason: 'No successful queries. Start with 1-hour ranges.',
        maxSafeRange: '1h'
      };
    }
    
    return results;
  }

  // Public method to access the SQL client for testing
  getSQLClient() {
    if (!this.influx3Client) {
      throw new Error('InfluxDB client not initialized');
    }
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