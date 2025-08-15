import { Injectable, Logger } from '@nestjs/common';
import * as OneSignal from '@onesignal/node-onesignal';

@Injectable()
export class OneSignalService {
  private readonly logger = new Logger(OneSignalService.name);
  private client: OneSignal.DefaultApi;

  constructor() {
    // Initialize OneSignal client
    const configuration = OneSignal.createConfiguration({
      restApiKey: process.env.ONESIGNAL_REST_API_KEY,
    });
    
    this.client = new OneSignal.DefaultApi(configuration);
  }

  /**
   * Send notification to all subscribed users
   */
  async sendNotificationToAll(title: string, message: string, data?: Record<string, any>) {
    try {
      const notification = {
        app_id: process.env.ONESIGNAL_APP_ID,
        included_segments: ['Subscribed Users'],
        headings: { en: title },
        contents: { en: message },
        data: data || {},
      };

      const result = await this.client.createNotification(notification);
      this.logger.log(`Notification sent successfully: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send notification to specific users by their OneSignal player IDs
   */
  async sendNotificationToUsers(playerIds: string[], title: string, message: string, data?: Record<string, any>) {
    try {
      const notification = {
        app_id: process.env.ONESIGNAL_APP_ID,
        include_player_ids: playerIds,
        headings: { en: title },
        contents: { en: message },
        data: data || {},
      };

      const result = await this.client.createNotification(notification);
      this.logger.log(`Notification sent to ${playerIds.length} users: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to send notification to users: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send water supply status notification
   */
  async sendWaterSupplyNotification(deviceId: string, tankId: string, isOn: boolean, previousState: boolean) {
    const title = isOn ? '🚰 Water Supply Activated' : '💧 Water Supply Deactivated';
    const message = isOn 
      ? `${tankId.charAt(0).toUpperCase() + tankId.slice(1)} tank water supply is now active`
      : `${tankId.charAt(0).toUpperCase() + tankId.slice(1)} tank water supply has been deactivated`;
    
    const data = {
      type: 'water_supply',
      device_id: deviceId,
      tank_id: tankId,
      water_supply_on: isOn,
      previous_state: previousState,
      timestamp: new Date().toISOString(),
    };

    await this.sendNotificationToAll(title, message, data);
  }

  /**
   * Send sensor status notification
   */
  async sendSensorStatusNotification(deviceId: string, tankId: string, connected: boolean, working: boolean, previousConnected: boolean, previousWorking: boolean) {
    let title = '';
    let message = '';

    if (connected !== previousConnected) {
      if (connected) {
        title = '🔌 Sensor Reconnected';
        message = `${tankId.charAt(0).toUpperCase() + tankId.slice(1)} tank sensor is back online`;
      } else {
        title = '❌ Sensor Disconnected';
        message = `${tankId.charAt(0).toUpperCase() + tankId.slice(1)} tank sensor has gone offline`;
      }
    } else if (working !== previousWorking) {
      if (working) {
        title = '✅ Sensor Working';
        message = `${tankId.charAt(0).toUpperCase() + tankId.slice(1)} tank sensor is functioning normally`;
      } else {
        title = '⚠️ Sensor Malfunction';
        message = `${tankId.charAt(0).toUpperCase() + tankId.slice(1)} tank sensor is not working properly`;
      }
    }

    const data = {
      type: 'sensor_status',
      device_id: deviceId,
      tank_id: tankId,
      sensor_connected: connected,
      sensor_working: working,
      previous_connected: previousConnected,
      previous_working: previousWorking,
      timestamp: new Date().toISOString(),
    };

    await this.sendNotificationToAll(title, message, data);
  }

  /**
   * Send pump protection notification
   */
  async sendProtectionNotification(deviceId: string, protectionType: string, isActive: boolean) {
    const title = isActive ? '🛡️ Pump Protection Active' : '✅ Pump Protection Cleared';
    const message = isActive 
      ? `Pump protection (${protectionType}) has been activated`
      : `Pump protection (${protectionType}) has been cleared`;
    
    const data = {
      type: 'pump_protection',
      device_id: deviceId,
      protection_type: protectionType,
      protection_active: isActive,
      timestamp: new Date().toISOString(),
    };

    await this.sendNotificationToAll(title, message, data);
  }
}
