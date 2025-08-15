// Simple test script for OneSignal service
const { OneSignalService } = require('./dist/common/services/onesignal.service');

async function testOneSignal() {
  try {
    console.log('Testing OneSignal service...');
    
    // Check environment variables
    console.log('ONESIGNAL_APP_ID:', process.env.ONESIGNAL_APP_ID ? 'Set' : 'Not set');
    console.log('ONESIGNAL_REST_API_KEY:', process.env.ONESIGNAL_REST_API_KEY ? 'Set' : 'Not set');
    
    // Test service initialization
    const service = new OneSignalService();
    console.log('Service enabled:', service.isServiceEnabled());
    
    if (service.isServiceEnabled()) {
      console.log('Testing notification creation...');
      const result = await service.sendNotificationToAll(
        'Test Notification',
        'This is a test notification from the water pump system',
        { test: true, timestamp: new Date().toISOString() }
      );
      
      if (result) {
        console.log('✅ Notification sent successfully:', result.id);
      } else {
        console.log('⚠️ Notification failed but service handled error gracefully');
      }
    } else {
      console.log('⚠️ OneSignal service is disabled - check environment variables');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error(error.stack);
  }
}

// Run the test
testOneSignal();
