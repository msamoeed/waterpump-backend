import { Controller, Post, Get, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DeviceStatusUpdateDto } from '../../common/dto/device-status-update.dto';

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
    @Body() query: { startTime?: string; endTime?: string; measurement?: string }
  ) {
    try {
      const { startTime, endTime, measurement = 'water_levels' } = query;
      
      if (!startTime || !endTime) {
        throw new HttpException(
          'Start time and end time are required', 
          HttpStatus.BAD_REQUEST
        );
      }
      
      const history = await this.devicesService.getDeviceHistory(
        deviceId, 
        measurement, 
        startTime, 
        endTime
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
} 