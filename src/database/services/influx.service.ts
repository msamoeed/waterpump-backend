import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { DeviceStatusUpdateDto } from '../../common/dto/device-status-update.dto';

@Injectable()
export class InfluxService implements OnApplicationShutdown {
  private influx3Client: InfluxDBClient;
  private connectionPool: Map<string, InfluxDBClient> = new Map();
  private readonly maxConnections = 5;
  private readonly connectionTimeout = 30000; // 30 seconds
  private queryCounter = 0;
  private lastCleanup = Date.now();
  private readonly cleanupInterval = 300000; // 5 minutes
  
  // Query caching to reduce high-frequency DB hits
  private queryCache: Map<string, { data: any[], timestamp: number, ttl: number }> = new Map();
  private readonly defaultCacheTTL = 15000; // 15 seconds cache for frequent queries
  private readonly latestDataCacheTTL = 5000; // 5 seconds cache for latest data queries

  constructor(private configService: ConfigService) {
    try {
      // Initialize InfluxDB 3.3 Core client
      // For InfluxDB 3.3 Core, we need to use the correct configuration
      const host = this.configService.get('INFLUXDB_URL') || 'http://localhost:8087';
      const token = this.configService.get('INFLUXDB_TOKEN') || 'dummy-token-for-no-auth-mode';
      const database = this.configService.get('INFLUXDB_BUCKET') || 'waterpump';

      console.log(`[DEBUG] InfluxDB 3.3 Configuration with Connection Pooling:`, {
        host,
        database,
        token: token ? '***' : 'not set (no-auth mode)',
        maxConnections: this.maxConnections
      });

      this.influx3Client = new InfluxDBClient({
        host,
        token,
        database,
      });

      // Initialize connection pool
      this.initializeConnectionPool(host, token, database);

      console.log(`[DEBUG] InfluxDB client and connection pool created successfully`);
    } catch (error) {
      console.error('[ERROR] Failed to initialize InfluxDB client:', error);
      throw new Error(`InfluxDB initialization failed: ${error.message}`);
    }
  }

  private initializeConnectionPool(host: string, token: string, database: string): void {
    // Pre-create connections in the pool
    for (let i = 0; i < this.maxConnections; i++) {
      const client = new InfluxDBClient({
        host,
        token,
        database,
      });
      this.connectionPool.set(`connection_${i}`, client);
    }
  }

  private getPooledConnection(): InfluxDBClient {
    // Clean up old connections periodically
    if (Date.now() - this.lastCleanup > this.cleanupInterval) {
      this.cleanupConnections();
    }

    // Use round-robin selection for load balancing
    const connectionKey = `connection_${this.queryCounter % this.maxConnections}`;
    this.queryCounter++;
    
    return this.connectionPool.get(connectionKey) || this.influx3Client;
  }

  private cleanupConnections(): void {
    // Clean up expired cache entries
    const now = Date.now();
    for (const [key, entry] of this.queryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.queryCache.delete(key);
      }
    }
    
    // Force garbage collection hint for connection cleanup
    if (global.gc) {
      global.gc();
    }
    this.lastCleanup = Date.now();
    console.log(`[DEBUG] Connection pool cleanup completed. Active queries: ${this.queryCounter}, Cache entries: ${this.queryCache.size}`);
  }

  private getCacheKey(method: string, ...params: any[]): string {
    return `${method}:${JSON.stringify(params)}`;
  }

  private getCachedQuery(cacheKey: string): any[] | null {
    const entry = this.queryCache.get(cacheKey);
    if (entry && (Date.now() - entry.timestamp) < entry.ttl) {
      console.log(`[DEBUG] Cache hit for key: ${cacheKey.substring(0, 50)}...`);
      return entry.data;
    }
    return null;
  }

  private setCachedQuery(cacheKey: string, data: any[], ttl: number): void {
    // Limit cache size to prevent memory issues
    if (this.queryCache.size > 100) {
      // Remove oldest entries
      const oldestKey = this.queryCache.keys().next().value;
      this.queryCache.delete(oldestKey);
    }
    
    this.queryCache.set(cacheKey, {
      data: [...data], // Create a copy to prevent reference issues
      timestamp: Date.now(),
      ttl
    });
  }

  async onApplicationShutdown(): Promise<void> {
    console.log('[DEBUG] Shutting down InfluxDB connections...');
    
    // Clear query cache
    this.queryCache.clear();
    
    // Close all pooled connections
    for (const [key, client] of this.connectionPool.entries()) {
      try {
        // Note: InfluxDB client doesn't have explicit close method, 
        // but we can clear references to help GC
        this.connectionPool.delete(key);
      } catch (error) {
        console.error(`[ERROR] Error closing connection ${key}:`, error);
      }
    }
    
    this.connectionPool.clear();
    console.log('[DEBUG] InfluxDB connections and cache cleared');
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
    let sqlQuery: string;
    
    if (measurement === 'water_levels') {
      if (aggregateWindow) {
        // Convert InfluxDB 2.x time units to InfluxDB 3.x DATE_TRUNC units
        const timeUnit = aggregateWindow === '1h' ? 'hour' : 
                        aggregateWindow === '1d' ? 'day' : 
                        aggregateWindow === '1m' ? 'minute' : 
                        aggregateWindow === '1s' ? 'second' : 'hour';
        
        // Use window function for aggregation with LIMIT for memory control
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
          LIMIT 1000
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
          LIMIT 500
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
          LIMIT 1000
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
          LIMIT 500
        `;
      }
    } else {
      // For other measurements, use simple query with limit
      sqlQuery = `
        SELECT * FROM ${measurement} 
        WHERE device_id = '${deviceId}' 
          AND time >= '${startTime}' 
          AND time <= '${endTime}'
        ORDER BY time
        LIMIT 500
      `;
    }

    console.log(`[DEBUG] InfluxDB SQL Query (Pool): ${sqlQuery.substring(0, 100)}...`);

    try {
      // Use pooled connection and optimized result collection
      const client = this.getPooledConnection();
      const result = await this.executeQueryWithOptimizedBuffering(client, sqlQuery);
      console.log(`[DEBUG] InfluxDB SQL Result: ${result.length} records found`);
      return result;
    } catch (error) {
      console.error('InfluxDB SQL query error:', error);
      throw error;
    }
  }

  private async executeQueryWithOptimizedBuffering(client: InfluxDBClient, sqlQuery: string): Promise<any[]> {
    const result: any[] = [];
    const batchSize = 50; // Process in smaller batches
    let batchCount = 0;
    
    try {
      for await (const row of client.query(sqlQuery)) {
        result.push(row);
        batchCount++;
        
        // Yield control periodically to prevent blocking
        if (batchCount % batchSize === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
        
        // Hard limit to prevent memory exhaustion
        if (result.length >= 2000) {
          console.warn(`[WARNING] Query result truncated at ${result.length} records to prevent memory issues`);
          break;
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error in optimized query execution:', error);
      throw error;
    }
  }



  // Public method to access the SQL client for testing
  getSQLClient() {
    if (!this.influx3Client) {
      throw new Error('InfluxDB client not initialized');
    }
    return this.influx3Client;
  }

  async getLatestDeviceData(deviceId: string): Promise<any> {
    // Check cache first for this high-frequency query
    const cacheKey = this.getCacheKey('getLatestDeviceData', deviceId);
    const cachedResult = this.getCachedQuery(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

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
        ORDER BY time DESC
        LIMIT 2
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
        ORDER BY time DESC
        LIMIT 1
      ) combined_data
      ORDER BY time DESC
      LIMIT 5
    `;

    try {
      const client = this.getPooledConnection();
      const result = await this.executeQueryWithOptimizedBuffering(client, sqlQuery);
      
      // Cache the result with shorter TTL for latest data
      this.setCachedQuery(cacheKey, result, this.latestDataCacheTTL);
      
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
      LIMIT 1000
    `;

    try {
      const client = this.getPooledConnection();
      const result = await this.executeQueryWithOptimizedBuffering(client, sqlQuery);
      
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