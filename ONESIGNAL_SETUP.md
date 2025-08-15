# OneSignal Setup Guide

## Environment Variables

Add the following environment variables to your `.env` file:

```bash
# OneSignal Configuration
ONESIGNAL_APP_ID=your-onesignal-app-id
ONESIGNAL_REST_API_KEY=your-onesignal-rest-api-key
```

## OneSignal Setup Steps

1. **Create OneSignal Account**
   - Go to [OneSignal.com](https://onesignal.com) and create an account
   - Create a new app for your water pump system

2. **Get App ID and API Key**
   - In your OneSignal dashboard, go to Settings > Keys & IDs
   - Copy the App ID and REST API Key

3. **Configure Mobile App**
   - Add OneSignal SDK to your Flutter mobile app
   - Configure the App ID in your mobile app

4. **Test Notifications**
   - Send a test notification from OneSignal dashboard
   - Verify notifications are received on mobile devices

## Notification Types

The system will automatically send notifications for:

- **Water Supply Changes**: When water supply is activated/deactivated
- **Sensor Status Changes**: When sensors connect/disconnect or start/stop working
- **Pump Protection**: When protection systems are activated/cleared

## Mobile App Integration

The mobile app will receive these notifications and can:
- Display them in the notification tray
- Navigate to relevant screens when tapped
- Show notification history
- Allow users to configure notification preferences
