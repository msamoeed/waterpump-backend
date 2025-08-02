import { Controller, Post, Get, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DeviceStatusUpdateDto, PumpCommandDto } from '../../common/dto/device-status-update.dto';

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devicesService: DevicesService,
  ) {}

  @Post('status/update')
  async updateDeviceStatus(@Body() statusUpdate: DeviceStatusUpdateDto) {
    try {
      // Store in databases and process alerts
      await this.devicesService.updateDeviceStatus(statusUpdate);
      
      return { 
        success: true, 
        message: 'Status updated successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        'Failed to update status', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('events/pump')
  async handlePumpEvent(@Body() pumpEvent: any) {
    try {
      await this.devicesService.handlePumpEvent(pumpEvent);
      
      return { 
        success: true, 
        message: 'Pump event processed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        'Failed to process pump event', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('pump/control')
  async controlPump(@Body() pumpCommand: PumpCommandDto) {
    try {
      const result = await this.devicesService.handlePumpCommand(pumpCommand);
      
      return { 
        success: true, 
        message: 'Pump command sent successfully',
        command: pumpCommand,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        'Failed to send pump command', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('pump/command/:deviceId')
  async getPumpCommand(@Param('deviceId') deviceId: string) {
    try {
      const command = await this.devicesService.getPumpCommand(deviceId);
      return command;
    } catch (error) {
      throw new HttpException(
        'Failed to get pump command', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':deviceId/status')
  async getDeviceStatus(@Param('deviceId') deviceId: string) {
    try {
      const status = await this.devicesService.getCurrentStatus(deviceId);
      
      if (!status) {
        throw new HttpException(
          'Device not found or no recent data', 
          HttpStatus.NOT_FOUND
        );
      }
      
      return status;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to get device status', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('status')
  async getAllDevicesStatus() {
    try {
      return await this.devicesService.getAllDevicesStatus();
    } catch (error) {
      throw new HttpException(
        'Failed to get all devices status', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':deviceId/history')
  async getDeviceHistory(
    @Param('deviceId') deviceId: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('measurement') measurement?: string,
    @Query('aggregateWindow') aggregateWindow?: string
  ) {
    try {
      const measurementType = measurement || 'water_levels';
      
      // Default to last 24 hours if no time range provided
      const end = endTime || new Date().toISOString();
      const start = startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const history = await this.devicesService.getDeviceHistory(
        deviceId, 
        measurementType, 
        start, 
        end,
        aggregateWindow
      );
      
      return history;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to get device history', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('system/stats')
  async getSystemStats() {
    try {
      return await this.devicesService.getSystemStats();
    } catch (error) {
      throw new HttpException(
        'Failed to get system stats', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':deviceId/timeseries')
  async getTimeSeriesData(
    @Param('deviceId') deviceId: string,
    @Query('hours') hours?: string,
    @Query('aggregateWindow') aggregateWindow?: string
  ) {
    try {
      const hoursCount = parseInt(hours || '24');
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - hoursCount * 60 * 60 * 1000).toISOString();
      
      console.log(`[DEBUG] TimeSeries Query: deviceId=${deviceId}, startTime=${startTime}, endTime=${endTime}`);
      
      const timeSeriesData = await this.devicesService.getTimeSeriesData(
        deviceId,
        startTime,
        endTime,
        aggregateWindow || '1h'
      );
      
      console.log(`[DEBUG] TimeSeries Result: ${timeSeriesData.length} records found`);
      
      return timeSeriesData;
    } catch (error) {
      console.error('[DEBUG] TimeSeries Error:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to get time series data', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('debug/influxdb')
  async debugInfluxDB() {
    try {
      const bucket = process.env.INFLUXDB_BUCKET || 'waterpump';
      const org = process.env.INFLUXDB_ORG || 'your-org';
      const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
      
      console.log('[DEBUG] InfluxDB Config:', { bucket, org, url });
      
      // Test basic query
      const testData = await this.devicesService.getDeviceHistory(
        'esp32_controller_001',
        'water_levels',
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
      );
      
      return {
        config: { bucket, org, url },
        testQuery: {
          deviceId: 'esp32_controller_001',
          measurement: 'water_levels',
          recordsFound: testData.length,
          sampleData: testData.slice(0, 3)
        }
      };
    } catch (error) {
      console.error('[DEBUG] InfluxDB Debug Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get('debug/sql')
  async debugSQL() {
    try {
      // Test simple SQL query to check if data exists
      const sqlQuery = `
        SELECT 
          time,
          device_id,
          tank_id,
          level_percent,
          level_inches
        FROM water_levels 
        WHERE device_id = 'test_device_001' 
          AND time >= NOW() - INTERVAL '1 hour'
        ORDER BY time DESC
        LIMIT 5
      `;
      
      const result = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(sqlQuery)) {
        result.push(row);
      }
      
      if (result.length === 0) {
        return {
          status: 'No data found',
          message: 'The water_levels table exists but has no recent data.',
          suggestion: 'Try sending some device data or check for older data.',
          sqlQuery,
          recordsFound: 0,
          sampleData: []
        };
      }
      
      return {
        status: 'Success',
        sqlQuery,
        recordsFound: result.length,
        sampleData: result.slice(0, 3),
        allData: result
      };
    } catch (error) {
      console.error('[DEBUG] SQL Debug Error:', error);
      
      // Check if it's a "table not found" error
      if (error.message && error.message.includes('table') && error.message.includes('not found')) {
        return {
          status: 'Table not found',
          message: 'The water_levels table does not exist yet.',
          suggestion: 'Send some device data to create the first measurements.',
          error: error.message
        };
      }
      
      return {
        status: 'Error',
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get('debug/connection-test')
  async getConnectionTest() {
    try {
      console.log('[DEBUG] Testing InfluxDB connection...');
      
      // Test 1: Simple query to see if we can connect
      const simpleQuery = `SELECT 1 as test`;
      
      const result = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(simpleQuery)) {
        result.push(row);
      }
      
      // Test 2: Check current timestamp
      const timeQuery = `SELECT NOW() as current_time`;
      
      const timeResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(timeQuery)) {
        timeResult.push(row);
      }
      
      // Test 3: List all tables
      const tablesQuery = `SHOW TABLES`;
      
      const tablesResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(tablesQuery)) {
        tablesResult.push(row);
      }
      
      // Test 4: Try to get a count from water_levels
      const countQuery = `SELECT COUNT(*) as total_records FROM water_levels`;
      
      const countResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(countQuery)) {
        countResult.push(row);
      }
      
      return {
        connectionTest: {
          success: result.length > 0,
          result: result
        },
        timeInfo: {
          success: timeResult.length > 0,
          currentTime: timeResult.length > 0 ? timeResult[0].current_time : 'unknown'
        },
        tables: {
          success: tablesResult.length > 0,
          count: tablesResult.length,
          tables: tablesResult
        },
        waterLevelsCount: {
          success: countResult.length > 0,
          totalRecords: countResult.length > 0 ? countResult[0].total_records : 0
        }
      };
    } catch (error) {
      console.error('[DEBUG] Connection Test Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get('debug/config')
  async getConfig() {
    try {
      console.log('[DEBUG] Checking InfluxDB configuration...');
      
      const config = {
        INFLUXDB_URL: process.env.INFLUXDB_URL || 'not set',
        INFLUXDB_TOKEN: process.env.INFLUXDB_TOKEN ? '***' : 'not set',
        INFLUXDB_BUCKET: process.env.INFLUXDB_BUCKET || 'not set',
        INFLUXDB_ORG: process.env.INFLUXDB_ORG || 'not set',
        NODE_ENV: process.env.NODE_ENV || 'not set'
      };
      
      console.log('[DEBUG] Environment config:', config);
      
      // Try to get the InfluxDB client configuration
      const clientConfig = {
        clientExists: !!this.devicesService.influxService.getSQLClient(),
        clientType: typeof this.devicesService.influxService.getSQLClient()
      };
      
      return {
        environment: config,
        clientConfig: clientConfig,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[DEBUG] Config Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get(':deviceId/water-supply/sessions')
  async getWaterSupplySessions(
    @Param('deviceId') deviceId: string,
    @Query('tankId') tankId: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string
  ) {
    try {
      if (!tankId) {
        throw new HttpException('tankId parameter is required', HttpStatus.BAD_REQUEST);
      }
      
      const end = endTime || new Date().toISOString();
      const start = startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const result = await this.devicesService.getWaterSupplySessions(deviceId, tankId, start, end);
      
      return {
        device_id: deviceId,
        tank_id: tankId,
        start_time: start,
        end_time: end,
        ...result
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to get water supply sessions', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':deviceId/water-supply/stats')
  async getWaterSupplyStats(
    @Param('deviceId') deviceId: string,
    @Query('tankId') tankId: string,
    @Query('days') days?: string
  ) {
    try {
      if (!tankId) {
        throw new HttpException('tankId parameter is required', HttpStatus.BAD_REQUEST);
      }
      
      const daysCount = parseInt(days || '30');
      const result = await this.devicesService.getWaterSupplyStats(deviceId, tankId, daysCount);
      
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to get water supply stats', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':deviceId/water-supply/status')
  async getCurrentWaterSupplyStatus(
    @Param('deviceId') deviceId: string
  ) {
    try {
      const result = await this.devicesService.getCurrentWaterSupplyStatus(deviceId);
      return result;
    } catch (error) {
      throw new HttpException(
        'Failed to get current water supply status', 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':deviceId/debug/raw-data')
  async getRawData(
    @Param('deviceId') deviceId: string,
    @Query('hours') hours?: string
  ) {
    try {
      const hoursCount = parseInt(hours || '24');
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - hoursCount * 60 * 60 * 1000).toISOString();
      
      console.log(`[DEBUG] Raw Data Query: deviceId=${deviceId}, startTime=${startTime}, endTime=${endTime}`);
      
      // Query without aggregation
      const waterLevelsData = await this.devicesService.influxService.queryHistoricalData(
        deviceId,
        'water_levels',
        startTime,
        endTime
      );
      
      const pumpMetricsData = await this.devicesService.influxService.queryHistoricalData(
        deviceId,
        'pump_metrics',
        startTime,
        endTime
      );
      
      return {
        deviceId,
        timeRange: { startTime, endTime },
        waterLevels: {
          count: waterLevelsData.length,
          sampleData: waterLevelsData.slice(0, 3)
        },
        pumpMetrics: {
          count: pumpMetricsData.length,
          sampleData: pumpMetricsData.slice(0, 3)
        }
      };
    } catch (error) {
      console.error('[DEBUG] Raw Data Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get(':deviceId/debug/time-test')
  async getTimeTest(
    @Param('deviceId') deviceId: string
  ) {
    try {
      const hoursCount = 24;
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - hoursCount * 60 * 60 * 1000).toISOString();
      
      console.log(`[DEBUG] Time Test: deviceId=${deviceId}`);
      console.log(`[DEBUG] Current time: ${new Date().toISOString()}`);
      console.log(`[DEBUG] Query time range: ${startTime} to ${endTime}`);
      
      // Test direct SQL query without time filtering first
      const testQuery = `
        SELECT 
          time,
          device_id,
          tank_id,
          level_percent
        FROM water_levels 
        WHERE device_id = '${deviceId}'
        ORDER BY time DESC
        LIMIT 5
      `;
      
      const result = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(testQuery)) {
        result.push(row);
      }
      
      return {
        deviceId,
        currentTime: new Date().toISOString(),
        queryTimeRange: { startTime, endTime },
        directQueryResult: {
          count: result.length,
          data: result
        }
      };
    } catch (error) {
      console.error('[DEBUG] Time Test Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get(':deviceId/debug/comprehensive')
  async getComprehensiveDebug(
    @Param('deviceId') deviceId: string
  ) {
    try {
      console.log(`[DEBUG] Comprehensive Debug for deviceId: ${deviceId}`);
      
      // Test 1: Check all tables in the database
      const tablesQuery = `
        SELECT table_name, table_schema 
        FROM information_schema.tables 
        WHERE table_schema IN ('public', 'iox', 'system')
        ORDER BY table_schema, table_name
      `;
      
      const tables = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(tablesQuery)) {
        tables.push(row);
      }
      
      // Test 2: Try different table name variations
      const testQueries = [
        {
          name: "iox.water_levels",
          query: `SELECT COUNT(*) as count FROM iox.water_levels WHERE device_id = '${deviceId}'`
        },
        {
          name: "public.water_levels", 
          query: `SELECT COUNT(*) as count FROM public.water_levels WHERE device_id = '${deviceId}'`
        },
        {
          name: "water_levels (no schema)",
          query: `SELECT COUNT(*) as count FROM water_levels WHERE device_id = '${deviceId}'`
        }
      ];
      
      const queryResults = [];
      for (const testQuery of testQueries) {
        try {
          const result = [];
          for await (const row of this.devicesService.influxService.getSQLClient().query(testQuery.query)) {
            result.push(row);
          }
          queryResults.push({
            name: testQuery.name,
            success: true,
            count: result.length > 0 ? result[0].count : 0
          });
        } catch (error) {
          queryResults.push({
            name: testQuery.name,
            success: false,
            error: error.message
          });
        }
      }
      
      // Test 3: Get sample data from any working table
      let sampleData: any = [];
      try {
        const sampleQuery = `
          SELECT time, device_id, tank_id, level_percent
          FROM iox.water_levels 
          ORDER BY time DESC
          LIMIT 3
        `;
        for await (const row of this.devicesService.influxService.getSQLClient().query(sampleQuery)) {
          sampleData.push(row);
        }
      } catch (error) {
        sampleData = { error: error.message };
      }
      
      return {
        deviceId,
        currentTime: new Date().toISOString(),
        tables: tables,
        queryTests: queryResults,
        sampleData: sampleData
      };
    } catch (error) {
      console.error('[DEBUG] Comprehensive Debug Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get('debug/simple-query')
  async getSimpleQuery() {
    try {
      console.log('[DEBUG] Testing simple query...');
      
      // Test 1: Just count records in water_levels
      const countQuery = `SELECT COUNT(*) as count FROM water_levels`;
      
      const countResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(countQuery)) {
        countResult.push(row);
      }
      
      // Test 2: Get one record from water_levels
      const sampleQuery = `SELECT * FROM water_levels LIMIT 1`;
      
      const sampleResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(sampleQuery)) {
        sampleResult.push(row);
      }
      
      // Test 3: Check if device_id exists
      const deviceQuery = `SELECT DISTINCT device_id FROM water_levels LIMIT 5`;
      
      const deviceResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(deviceQuery)) {
        deviceResult.push(row);
      }
      
      return {
        countTest: {
          success: countResult.length > 0,
          count: countResult.length > 0 ? countResult[0].count : 0
        },
        sampleTest: {
          success: sampleResult.length > 0,
          record: sampleResult.length > 0 ? sampleResult[0] : null
        },
        deviceTest: {
          success: deviceResult.length > 0,
          devices: deviceResult
        }
      };
    } catch (error) {
      console.error('[DEBUG] Simple Query Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get('debug/cli-mimic')
  async getCliMimic() {
    try {
      console.log('[DEBUG] Testing CLI-mimic query...');
      
      // Test the exact query that works in CLI
      const cliQuery = `SELECT DISTINCT device_id FROM water_levels`;
      
      const result = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(cliQuery)) {
        result.push(row);
      }
      
      return {
        success: true,
        query: cliQuery,
        result: result,
        count: result.length
      };
    } catch (error) {
      console.error('[DEBUG] CLI Mimic Error:', error);
      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get(':deviceId/debug/timeseries-test')
  async getTimeseriesTest(
    @Param('deviceId') deviceId: string,
    @Query('hours') hours?: string
  ) {
    try {
      const hoursCount = parseInt(hours || '24');
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - hoursCount * 60 * 60 * 1000).toISOString();
      
      console.log(`[DEBUG] Timeseries Test: deviceId=${deviceId}`);
      console.log(`[DEBUG] Time range: ${startTime} to ${endTime}`);
      
      // Test 1: Query without time filtering
      const noTimeQuery = `SELECT * FROM water_levels WHERE device_id = '${deviceId}' ORDER BY time DESC LIMIT 5`;
      
      const noTimeResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(noTimeQuery)) {
        noTimeResult.push(row);
      }
      
      // Test 2: Query with time filtering
      const timeQuery = `SELECT * FROM water_levels WHERE device_id = '${deviceId}' AND time >= '${startTime}' AND time <= '${endTime}' ORDER BY time DESC LIMIT 5`;
      
      const timeResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(timeQuery)) {
        timeResult.push(row);
      }
      
      // Test 3: Check the actual data timestamps
      const timestampQuery = `SELECT time, device_id FROM water_levels WHERE device_id = '${deviceId}' ORDER BY time DESC LIMIT 3`;
      
      const timestampResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(timestampQuery)) {
        timestampResult.push(row);
      }
      
      return {
        deviceId,
        timeRange: { startTime, endTime },
        noTimeFilter: {
          count: noTimeResult.length,
          data: noTimeResult
        },
        withTimeFilter: {
          count: timeResult.length,
          data: timeResult
        },
        timestamps: {
          count: timestampResult.length,
          data: timestampResult
        }
      };
    } catch (error) {
      console.error('[DEBUG] Timeseries Test Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get('debug/database-check')
  async getDatabaseCheck() {
    try {
      console.log('[DEBUG] Checking database connection...');
      
      // Test 1: Check what we can see in the current database
      const allTablesQuery = `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
      
      const allTables = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(allTablesQuery)) {
        allTables.push(row);
      }
      
      // Test 2: Try to get any data from water_levels without device filter
      const anyDataQuery = `SELECT * FROM water_levels LIMIT 3`;
      
      const anyData = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(anyDataQuery)) {
        anyData.push(row);
      }
      
      // Test 3: Check if we can see the test_device_001 data
      const testDeviceQuery = `SELECT device_id, time FROM water_levels WHERE device_id = 'test_device_001' LIMIT 3`;
      
      const testDeviceData = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(testDeviceQuery)) {
        testDeviceData.push(row);
      }
      
      // Test 4: Check if we can see the esp32_controller_001 data
      const esp32DeviceQuery = `SELECT device_id, time FROM water_levels WHERE device_id = 'esp32_controller_001' LIMIT 3`;
      
      const esp32DeviceData = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(esp32DeviceQuery)) {
        esp32DeviceData.push(row);
      }
      
      return {
        allTables: {
          count: allTables.length,
          tables: allTables
        },
        anyData: {
          count: anyData.length,
          data: anyData
        },
        testDeviceData: {
          count: testDeviceData.length,
          data: testDeviceData
        },
        esp32DeviceData: {
          count: esp32DeviceData.length,
          data: esp32DeviceData
        }
      };
    } catch (error) {
      console.error('[DEBUG] Database Check Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }

  @Get(':deviceId/debug/direct-query')
  async getDirectQuery(
    @Param('deviceId') deviceId: string
  ) {
    try {
      console.log(`[DEBUG] Direct query for deviceId: ${deviceId}`);
      
      // Direct query to check if device exists
      const deviceQuery = `SELECT device_id, COUNT(*) as record_count FROM water_levels WHERE device_id = '${deviceId}' GROUP BY device_id`;
      
      const deviceResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(deviceQuery)) {
        deviceResult.push(row);
      }
      
      // Direct query to get sample data
      const sampleQuery = `SELECT * FROM water_levels WHERE device_id = '${deviceId}' ORDER BY time DESC LIMIT 3`;
      
      const sampleResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(sampleQuery)) {
        sampleResult.push(row);
      }
      
      // Direct query to check pump metrics
      const pumpQuery = `SELECT * FROM pump_metrics WHERE device_id = '${deviceId}' ORDER BY time DESC LIMIT 3`;
      
      const pumpResult = [];
      for await (const row of this.devicesService.influxService.getSQLClient().query(pumpQuery)) {
        pumpResult.push(row);
      }
      
      return {
        deviceId,
        deviceExists: deviceResult.length > 0,
        deviceInfo: deviceResult,
        waterLevelsData: {
          count: sampleResult.length,
          data: sampleResult
        },
        pumpMetricsData: {
          count: pumpResult.length,
          data: pumpResult
        }
      };
    } catch (error) {
      console.error('[DEBUG] Direct Query Error:', error);
      return {
        error: error.message,
        stack: error.stack
      };
    }
  }
} 