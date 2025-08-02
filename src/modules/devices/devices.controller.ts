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
} 