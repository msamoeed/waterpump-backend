import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as duckdb from 'duckdb';
import { DeviceStatusUpdateDto } from '../../common/dto/device-status-update.dto';

@Injectable()
export class DuckDBService implements OnApplicationShutdown {
  private db: duckdb.Database;
  private connection: duckdb.Connection;
  private readonly dbPath: string;
  private queryCache: Map<string, { data: any[], timestamp: number, ttl: number }> = new Map();
  private readonly defaultCacheTTL = 15000; // 15 seconds cache for frequent queries
  private readonly latestDataCacheTTL = 5000; // 5 seconds cache for latest data queries
  private lastCleanup = Date.now();
  private readonly cleanupInterval = 300000; // 5 minutes

  constructor(private configService: ConfigService) {
    try {
      // Initialize DuckDB with optimized settings for time-series data
      this.dbPath = this.configService.get('DUCKDB_PATH') || './waterpump_data.duckdb';
      
      console.log(`[DEBUG] DuckDB Configuration:`, {
        dbPath: this.dbPath,
        memoryLimit: '2GB',
        threads: '4'
      });

      // Create database with optimized settings
      this.db = new duckdb.Database(this.dbPath, (err) => {
        if (err) {
          console.error('[ERROR] Failed to create DuckDB database:', err);
          throw new Error(`DuckDB initialization failed: ${err.message}`);
        }
        console.log('[DEBUG] DuckDB database created/opened successfully');
      });

      // Create connection with memory optimization
      this.connection = new duckdb.Connection(this.db, (err) => {
        if (err) {
          console.error('[ERROR] Failed to create DuckDB connection:', err);
          throw new Error(`DuckDB connection failed: ${err.message}`);
        }
        console.log('[DEBUG] DuckDB connection established successfully');
      });

      // Initialize database schema and tables
      this.initializeDatabase();
      
      console.log('[DEBUG] DuckDB service initialized successfully');
    } catch (error) {
      console.error('[ERROR] Failed to initialize DuckDB service:', error);
      throw new Error(`DuckDB service initialization failed: ${error.message}`);
    }
  }

  private initializeDatabase(): void {
    // Set memory limits and optimization settings
    this.connection.exec(`
      SET memory_limit='2GB';
      SET threads=4;
      SET enable_progress_bar=false;
      SET enable_external_access=false;
    `);

    // Create tables if they don't exist
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS water_levels (
        time TIMESTAMP NOT NULL,
        device_id VARCHAR NOT NULL,
        tank_id VARCHAR NOT NULL,
        level_percent DOUBLE,
        level_inches DOUBLE,
        alarm_active BOOLEAN,
        connected BOOLEAN,
        sensor_working BOOLEAN,
        water_supply_on BOOLEAN,
        PRIMARY KEY (time, device_id, tank_id)
      );

      CREATE TABLE IF NOT EXISTS pump_metrics (
        time TIMESTAMP NOT NULL,
        device_id VARCHAR NOT NULL,
        current_amps DOUBLE,
        power_watts DOUBLE,
        daily_consumption DOUBLE,
        hourly_consumption DOUBLE,
        running BOOLEAN,
        protection_active BOOLEAN,
        runtime_minutes INTEGER,
        total_runtime_hours INTEGER,
        PRIMARY KEY (time, device_id)
      );

      CREATE TABLE IF NOT EXISTS system_events (
        time TIMESTAMP NOT NULL,
        device_id VARCHAR NOT NULL,
        event_type VARCHAR NOT NULL,
        severity VARCHAR NOT NULL,
        description VARCHAR,
        PRIMARY KEY (time, device_id, event_type)
      );
    `);

    // Create optimized indexes for time-series queries
    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_water_levels_time_device ON water_levels(time DESC, device_id);
      CREATE INDEX IF NOT EXISTS idx_water_levels_device_time ON water_levels(device_id, time DESC);
      CREATE INDEX IF NOT EXISTS idx_pump_metrics_time_device ON pump_metrics(time DESC, device_id);
      CREATE INDEX IF NOT EXISTS idx_pump_metrics_device_time ON pump_metrics(device_id, time DESC);
      CREATE INDEX IF NOT EXISTS idx_system_events_time_device ON system_events(time DESC, device_id);
    `);

    console.log('[DEBUG] DuckDB schema initialized with optimized indexes');
  }

  async writeWaterLevels(statusUpdate: DeviceStatusUpdateDto, timestamp: Date): Promise<void> {
    const points = [
      {
        time: timestamp.toISOString(),
        device_id: statusUpdate.device_id,
        tank_id: 'ground',
        level_percent: statusUpdate.ground_tank.level_percent,
        level_inches: statusUpdate.ground_tank.level_inches,
        alarm_active: statusUpdate.ground_tank.alarm_active,
        connected: statusUpdate.ground_tank.connected,
        sensor_working: statusUpdate.ground_tank.sensor_working,
        water_supply_on: statusUpdate.ground_tank.water_supply_on
      },
      {
        time: timestamp.toISOString(),
        device_id: statusUpdate.device_id,
        tank_id: 'roof',
        level_percent: statusUpdate.roof_tank.level_percent,
        level_inches: statusUpdate.roof_tank.level_inches,
        alarm_active: statusUpdate.roof_tank.alarm_active,
        connected: statusUpdate.roof_tank.connected,
        sensor_working: statusUpdate.roof_tank.sensor_working,
        water_supply_on: statusUpdate.roof_tank.water_supply_on
      }
    ];

    try {
      await this.batchInsert('water_levels', points);
      console.log(`[DEBUG] Wrote ${points.length} water level points to DuckDB`);
    } catch (error) {
      console.error('Error writing water levels to DuckDB:', error);
      throw error;
    }
  }

  async writePumpMetrics(statusUpdate: DeviceStatusUpdateDto, timestamp: Date): Promise<void> {
    const point = {
      time: timestamp.toISOString(),
      device_id: statusUpdate.device_id,
      current_amps: statusUpdate.pump.current_amps,
      power_watts: statusUpdate.pump.power_watts,
      daily_consumption: statusUpdate.pump.daily_consumption,
      hourly_consumption: statusUpdate.pump.hourly_consumption,
      running: statusUpdate.pump.running,
      protection_active: statusUpdate.pump.protection_active,
      runtime_minutes: statusUpdate.pump.runtime_minutes,
      total_runtime_hours: statusUpdate.pump.total_runtime_hours
    };

    try {
      await this.batchInsert('pump_metrics', [point]);
      console.log(`[DEBUG] Wrote pump metrics point to DuckDB`);
    } catch (error) {
      console.error('Error writing pump metrics to DuckDB:', error);
      throw error;
    }
  }

  async writeSystemEvent(deviceId: string, eventType: string, description: string, severity: string, timestamp: Date): Promise<void> {
    const point = {
      time: timestamp.toISOString(),
      device_id: deviceId,
      event_type: eventType,
      severity: severity,
      description: description
    };

    try {
      await this.batchInsert('system_events', [point]);
      console.log(`[DEBUG] Wrote system event point to DuckDB`);
    } catch (error) {
      console.error('Error writing system event to DuckDB:', error);
      throw error;
    }
  }

  private async batchInsert(table: string, data: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (data.length === 0) {
        resolve();
        return;
      }

      // Build the INSERT statement with explicit values
      const columns = Object.keys(data[0]);
      const valuesList = data.map(row => {
        const values = columns.map(col => {
          const value = row[col];
          if (value === null || value === undefined) {
            return 'NULL';
          } else if (typeof value === 'string') {
            return `'${value.replace(/'/g, "''")}'`;
          } else if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
          } else {
            return value.toString();
          }
        });
        return `(${values.join(', ')})`;
      }).join(', ');

      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuesList}`;
      
      this.connection.exec(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
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
        const timeUnit = aggregateWindow === '1h' ? 'hour' : 
                        aggregateWindow === '1d' ? 'day' : 
                        aggregateWindow === '1m' ? 'minute' : 
                        aggregateWindow === '1s' ? 'second' : 'hour';
        
        sqlQuery = `
          SELECT 
            date_trunc('${timeUnit}', time) as time,
            device_id,
            tank_id,
            AVG(level_percent) as level_percent,
            AVG(level_inches) as level_inches,
            MAX(CASE WHEN alarm_active THEN 1 ELSE 0 END) as alarm_active,
            MAX(CASE WHEN connected THEN 1 ELSE 0 END) as connected,
            MAX(CASE WHEN sensor_working THEN 1 ELSE 0 END) as sensor_working,
            MAX(CASE WHEN water_supply_on THEN 1 ELSE 0 END) as water_supply_on
          FROM water_levels 
          WHERE device_id = ? 
            AND tank_id IN ('ground', 'roof')
            AND time >= ? 
            AND time <= ?
          GROUP BY date_trunc('${timeUnit}', time), device_id, tank_id
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
          WHERE device_id = ? 
            AND tank_id IN ('ground', 'roof')
            AND time >= ? 
            AND time <= ?
          ORDER BY time DESC
          LIMIT 500
        `;
      }
    } else if (measurement === 'pump_metrics') {
      if (aggregateWindow) {
        const timeUnit = aggregateWindow === '1h' ? 'hour' : 
                        aggregateWindow === '1d' ? 'day' : 
                        aggregateWindow === '1m' ? 'minute' : 
                        aggregateWindow === '1s' ? 'second' : 'hour';
        
        sqlQuery = `
          SELECT 
            date_trunc('${timeUnit}', time) as time,
            device_id,
            AVG(current_amps) as current_amps,
            AVG(power_watts) as power_watts,
            MAX(CASE WHEN running THEN 1 ELSE 0 END) as running,
            MAX(CASE WHEN protection_active THEN 1 ELSE 0 END) as protection_active,
            AVG(runtime_minutes) as runtime_minutes,
            AVG(total_runtime_hours) as total_runtime_hours
          FROM pump_metrics 
          WHERE device_id = ? 
            AND time >= ? 
            AND time <= ?
          GROUP BY date_trunc('${timeUnit}', time), device_id
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
          WHERE device_id = ? 
            AND time >= ? 
            AND time <= ?
          ORDER BY time DESC
          LIMIT 500
        `;
      }
    } else {
      sqlQuery = `
        SELECT * FROM ${measurement} 
        WHERE device_id = ? 
          AND time >= ? 
          AND time <= ?
        ORDER BY time DESC
        LIMIT 500
      `;
    }

    console.log(`[DEBUG] DuckDB SQL Query: ${sqlQuery.substring(0, 100)}...`);

    try {
      const result = await this.executeQuery(sqlQuery, [deviceId, startTime, endTime]);
      console.log(`[DEBUG] DuckDB SQL Result: ${result.length} records found`);
      return result;
    } catch (error) {
      console.error('DuckDB SQL query error:', error);
      throw error;
    }
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
          CAST(NULL AS DOUBLE) as current_amps,
          CAST(NULL AS DOUBLE) as power_watts,
          CAST(NULL AS BOOLEAN) as running
        FROM water_levels 
        WHERE device_id = ? AND time >= (NOW() - INTERVAL '1 hour')
        ORDER BY time DESC
        LIMIT 2
      )
      ORDER BY time DESC
      LIMIT 5
    `;

    try {
      const result = await this.executeQuery(sqlQuery, [deviceId]);
      
      // Cache the result with shorter TTL for latest data
      this.setCachedQuery(cacheKey, result, this.latestDataCacheTTL);
      
      return result;
    } catch (error) {
      console.error('DuckDB latest data query error:', error);
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
      WHERE device_id = ? 
        AND tank_id = ?
        AND time >= ? 
        AND time <= ?
      ORDER BY time
      LIMIT 1000
    `;

    try {
      const result = await this.executeQuery(sqlQuery, [deviceId, tankId, startTime, endTime]);
      
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
      console.error('DuckDB water supply query error:', error);
      throw error;
    }
  }

  private async executeQuery(sqlQuery: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const result: any[] = [];
      
      // Replace parameter placeholders with actual values
      let finalQuery = sqlQuery;
      params.forEach((param, index) => {
        const placeholder = '?';
        const value = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : param;
        finalQuery = finalQuery.replace(placeholder, value);
      });
      
      this.connection.all(finalQuery, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (rows) {
          result.push(...rows);
        }
        
        resolve(result);
      });
    });
  }

  // Cache management methods
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

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.queryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.queryCache.delete(key);
      }
    }
    
    // Force garbage collection hint
    if (global.gc) {
      global.gc();
    }
    
    this.lastCleanup = Date.now();
    console.log(`[DEBUG] DuckDB cache cleanup completed. Cache entries: ${this.queryCache.size}`);
  }

  // Public method to access the DuckDB client for testing
  getDBClient() {
    if (!this.connection) {
      throw new Error('DuckDB connection not initialized');
    }
    return this.connection;
  }

  async onApplicationShutdown(): Promise<void> {
    console.log('[DEBUG] Shutting down DuckDB connections...');
    
    // Clear query cache
    this.queryCache.clear();
    
    // Close connection and database
    if (this.connection) {
      this.connection.close((err) => {
        if (err) {
          console.error('[ERROR] Error closing DuckDB connection:', err);
        } else {
          console.log('[DEBUG] DuckDB connection closed');
        }
      });
    }
    
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('[ERROR] Error closing DuckDB database:', err);
        } else {
          console.log('[DEBUG] DuckDB database closed');
        }
      });
    }
    
    console.log('[DEBUG] DuckDB service shutdown complete');
  }
}
