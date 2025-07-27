const axios = require('axios');

const BACKEND_URL = 'http://localhost:3002/api/v1';

async function testWaterSupplyTracking() {
  console.log('Testing Water Supply Duration Tracking (Simple Approach)...\n');

  try {
    // Test 1: Send status update with ground tank water supply ON
    console.log('1. Sending status with ground tank water supply ON...');
    const statusWithSupply = {
      device_id: 'esp32_controller_001',
      timestamp: Date.now(),
      ground_tank: {
        level_percent: 85.5,
        level_inches: 25.3,
        alarm_active: false,
        connected: true,
        sensor_working: true,
        water_supply_on: true
      },
      roof_tank: {
        level_percent: 45.2,
        level_inches: 18.7,
        alarm_active: false,
        connected: true,
        sensor_working: true,
        water_supply_on: false
      },
      pump: {
        running: true,
        manual_override: false,
        current_amps: 5.2,
        power_watts: 1196.0,
        daily_consumption: 2.5,
        hourly_consumption: 0.3,
        runtime_minutes: 45,
        total_runtime_hours: 12,
        protection_active: false,
        overcurrent_protection: false,
        overtime_protection: false
      },
      system: {
        auto_mode_enabled: true,
        manual_pump_control: false,
        water_supply_active: true
      }
    };

    await axios.post(`${BACKEND_URL}/devices/status/update`, statusWithSupply);
    console.log('✓ Status update sent successfully');

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: Send status update with ground tank water supply OFF
    console.log('\n2. Sending status with ground tank water supply OFF...');
    const statusWithoutSupply = {
      ...statusWithSupply,
      ground_tank: {
        ...statusWithSupply.ground_tank,
        water_supply_on: false
      },
      system: {
        ...statusWithSupply.system,
        water_supply_active: false
      }
    };

    await axios.post(`${BACKEND_URL}/devices/status/update`, statusWithoutSupply);
    console.log('✓ Status update sent successfully');

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3: Get current water supply status
    console.log('\n3. Getting current water supply status...');
    const statusResponse = await axios.get(`${BACKEND_URL}/devices/esp32_controller_001/water-supply/status`);
    console.log('✓ Current status:', statusResponse.data);

    // Test 4: Get water supply sessions for the last hour
    console.log('\n4. Getting water supply sessions for ground tank...');
    const sessionsResponse = await axios.get(`${BACKEND_URL}/devices/esp32_controller_001/water-supply/sessions?tankId=ground&startTime=${new Date(Date.now() - 60 * 60 * 1000).toISOString()}`);
    console.log('✓ Sessions retrieved:', sessionsResponse.data);

    // Test 5: Get water supply stats for the last 7 days
    console.log('\n5. Getting water supply stats for ground tank...');
    const statsResponse = await axios.get(`${BACKEND_URL}/devices/esp32_controller_001/water-supply/stats?tankId=ground&days=7`);
    console.log('✓ Stats retrieved:', statsResponse.data);

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📊 Key Benefits of This Approach:');
    console.log('✅ Uses existing water_supply_on boolean field');
    console.log('✅ No additional database tables needed');
    console.log('✅ Leverages InfluxDB time series capabilities');
    console.log('✅ Calculates durations from state changes');
    console.log('✅ Provides complete session history');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the test
testWaterSupplyTracking(); 