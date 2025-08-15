import { Injectable, Logger } from '@nestjs/common';
import * as OneSignal from '@onesignal/node-onesignal';

@Injectable()
export class OneSignalService {
  private readonly logger = new Logger(OneSignalService.name);
  private client: OneSignal.DefaultApi;
  private isEnabled: boolean;

  constructor() {
    // Check if OneSignal is properly configured
    this.isEnabled = !!(process.env.ONESIGNAL_REST_API_KEY && process.env.ONESIGNAL_APP_ID);
    
    if (!this.isEnabled) {
      this.logger.warn('OneSignal is not configured. Notifications will be logged but not sent.');
      return;
    }

    try {
      // Initialize OneSignal client using the correct configuration pattern
      const configuration = OneSignal.createConfiguration({
        restApiKey: process.env.ONESIGNAL_REST_API_KEY,
      });
      
      this.client = new OneSignal.DefaultApi(configuration);
      this.logger.log('OneSignal client initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize OneSignal client: ${error.message}`);
      this.isEnabled = false;
    }
  }

  /**
   * Send notification to all subscribed users
   */
  async sendNotificationToAll(title: string, message: string, data?: Record<string, any>) {
    if (!this.isEnabled || !this.client) {
      this.logger.log(`[OneSignal Disabled] Notification would be sent: ${title} - ${message}`);
      return null;
    }

    try {
      // Create notification using the correct SDK pattern
      const notification = new OneSignal.Notification();
      notification.app_id = process.env.ONESIGNAL_APP_ID;
      notification.included_segments = ['Subscribed Users'];
      notification.headings = { en: title };
      notification.contents = { en: message };
      notification.data = data || {};

      const result = await this.client.createNotification(notification);
      this.logger.log(`Notification sent successfully: ${result.id}`);
      return result;
    } catch (error) {
      // Handle specific OneSignal API errors
      if (error.message.includes('mediaType text/plain')) {
        this.logger.error('OneSignal API returned unsupported media type. This may be a temporary API issue.');
      } else if (error.message.includes('Unauthorized') || error.message.includes('401')) {
        this.logger.error('OneSignal API key is invalid or expired');
        this.isEnabled = false;
      } else if (error.message.includes('Rate limit')) {
        this.logger.warn('OneSignal rate limit reached, notification skipped');
      } else {
        this.logger.error(`Failed to send notification: ${error.message}`);
      }
      
      // Log the notification locally for debugging
      this.logger.log(`[Failed] Notification details: ${title} - ${message}`);
      return null;
    }
  }

  /**
   * Send notification to specific users by their OneSignal player IDs
   * Note: The new SDK uses include_subscription_ids instead of include_player_ids
   */
  async sendNotificationToUsers(playerIds: string[], title: string, message: string, data?: Record<string, any>) {
    if (!this.isEnabled || !this.client) {
      this.logger.log(`[OneSignal Disabled] Notification would be sent to ${playerIds.length} users: ${title} - ${message}`);
      return null;
    }

    try {
      // Create notification using the correct SDK pattern
      const notification = new OneSignal.Notification();
      notification.app_id = process.env.ONESIGNAL_APP_ID;
      notification.include_subscription_ids = playerIds; // Use the correct property name
      notification.headings = { en: title };
      notification.contents = { en: message };
      notification.data = data || {};

      const result = await this.client.createNotification(notification);
      this.logger.log(`Notification sent to ${playerIds.length} users: ${result.id}`);
      return result;
    } catch (error) {
      // Handle specific OneSignal API errors
      if (error.message.includes('mediaType text/plain')) {
        this.logger.error('OneSignal API returned unsupported media type. This may be a temporary API issue.');
      } else if (error.message.includes('Unauthorized') || error.message.includes('401')) {
        this.logger.error('OneSignal API key is invalid or expired');
        this.isEnabled = false;
      } else if (error.message.includes('Rate limit')) {
        this.logger.warn('OneSignal rate limit reached, notification skipped');
      } else {
        this.logger.error(`Failed to send notification to users: ${error.message}`);
      }
      
      // Log the notification locally for debugging
      this.logger.log(`[Failed] Notification to ${playerIds.length} users: ${title} - ${message}`);
      return null;
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

  /**
   * Check if OneSignal service is enabled
   */
  isServiceEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Re-enable the service (useful for recovery after errors)
   */
  reEnable(): void {
    if (process.env.ONESIGNAL_REST_API_KEY && process.env.ONESIGNAL_APP_ID) {
      this.isEnabled = true;
      this.logger.log('OneSignal service re-enabled');
    }
  }
}
