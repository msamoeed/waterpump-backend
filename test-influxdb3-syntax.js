#!/usr/bin/env node

/**
 * Test script to verify InfluxDB 3.3 syntax compatibility
 * Run with: node test-influxdb3-syntax.js
 */

const { InfluxDBClient, Point } = require('@influxdata/influxdb3-client');

// Test configuration
const config = {
  host: 'http://localhost:8087',
  token: 'dummy-token-for-no-auth-mode',
  database: 'waterpump'
};

async function testInfluxDB3Syntax() {
  console.log('🧪 Testing InfluxDB 3.3 Syntax Compatibility');
  console.log('=============================================');
  
  let client;
  
  try {
    // Initialize client
    console.log('🔌 Initializing InfluxDB 3.3 client...');
    client = new InfluxDBClient(config);
    console.log('✅ Client initialized successfully');
    
    // Test 1: Basic query syntax
    console.log('\n📊 Test 1: Basic SELECT query...');
    const basicQuery = `SELECT COUNT(*) as count FROM water_levels`;
    console.log(`Query: ${basicQuery}`);
    
    const basicResult = [];
    for await (const row of client.query(basicQuery)) {
      basicResult.push(row);
    }
    console.log(`✅ Basic query successful: ${basicResult.length} results`);
    
    // Test 2: Time-based query with LIMIT
    console.log('\n📊 Test 2: Time-based query with LIMIT...');
    const timeQuery = `
      SELECT time, device_id, level_percent 
      FROM water_levels 
      WHERE time >= '2025-08-29T00:00:00Z' 
        AND time <= '2025-08-29T23:59:59Z'
      ORDER BY time DESC 
      LIMIT 10
    `;
    console.log(`Query: ${timeQuery.trim()}`);
    
    const timeResult = [];
    for await (const row of client.query(timeQuery)) {
      timeResult.push(row);
    }
    console.log(`✅ Time query successful: ${timeResult.length} results`);
    
    // Test 3: Aggregation with time_bucket (InfluxDB 3.3 syntax)
    console.log('\n📊 Test 3: Aggregation with time_bucket...');
    const aggQuery = `
      SELECT 
        time_bucket(interval '1 hour', time) as time,
        device_id,
        AVG(level_percent) as avg_level
      FROM water_levels 
      WHERE time >= '2025-08-29T00:00:00Z' 
        AND time <= '2025-08-29T23:59:59Z'
      GROUP BY time_bucket(interval '1 hour', time), device_id
      ORDER BY time
      LIMIT 5
    `;
    console.log(`Query: ${aggQuery.trim()}`);
    
    const aggResult = [];
    for await (const row of client.query(aggQuery)) {
      aggResult.push(row);
    }
    console.log(`✅ Aggregation query successful: ${aggResult.length} results`);
    
    // Test 4: Complex query with multiple conditions
    console.log('\n📊 Test 4: Complex query with multiple conditions...');
    const complexQuery = `
      SELECT 
        time,
        device_id,
        tank_id,
        level_percent,
        level_inches
      FROM water_levels 
      WHERE device_id = 'esp32_controller_001'
        AND tank_id IN ('ground', 'roof')
        AND time >= '2025-08-29T00:00:00Z'
        AND time <= '2025-08-29T23:59:59Z'
        AND level_percent > 0
      ORDER BY time DESC
      LIMIT 5
    `;
    console.log(`Query: ${complexQuery.trim()}`);
    
    const complexResult = [];
    for await (const row of client.query(complexQuery)) {
      complexResult.push(row);
    }
    console.log(`✅ Complex query successful: ${complexResult.length} results`);
    
    // Test 5: Write test data
    console.log('\n📊 Test 5: Writing test data...');
    const testPoint = Point.measurement('test_syntax')
      .setTag('test_type', 'syntax_verification')
      .setStringField('message', 'Testing InfluxDB 3.3 syntax')
      .setIntegerField('test_number', 1)
      .setTimestamp(new Date());
    
    await client.write([testPoint]);
    console.log('✅ Test data written successfully');
    
    // Test 6: Read back test data
    console.log('\n📊 Test 6: Reading back test data...');
    const readBackQuery = `
      SELECT * FROM test_syntax 
      WHERE test_type = 'syntax_verification'
      ORDER BY time DESC 
      LIMIT 1
    `;
    
    const readBackResult = [];
    for await (const row of client.query(readBackQuery)) {
      readBackResult.push(row);
    }
    console.log(`✅ Read back successful: ${readBackResult.length} results`);
    
    console.log('\n🎉 All InfluxDB 3.3 syntax tests passed!');
    console.log('\n📋 Summary:');
    console.log('- Basic SELECT queries: ✅');
    console.log('- Time-based queries: ✅');
    console.log('- Aggregation with time_bucket: ✅');
    console.log('- Complex WHERE conditions: ✅');
    console.log('- Data writing: ✅');
    console.log('- Data reading: ✅');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    
    if (error.message.includes('time_bucket')) {
      console.log('\n💡 Hint: time_bucket function might not be available in this InfluxDB version');
      console.log('Try using a simpler aggregation or check InfluxDB documentation');
    }
    
    if (error.message.includes('syntax error')) {
      console.log('\n💡 Hint: Check the SQL syntax for your specific InfluxDB version');
      console.log('Some functions might have different names or syntax');
    }
    
    process.exit(1);
  } finally {
    if (client) {
      try {
        // Clean up test data
        const cleanupQuery = `DELETE FROM test_syntax WHERE test_type = 'syntax_verification'`;
        await client.query(cleanupQuery);
        console.log('\n🧹 Test data cleaned up');
      } catch (cleanupError) {
        console.log('\n⚠️  Could not clean up test data:', cleanupError.message);
      }
    }
  }
}

// Run the test
if (require.main === module) {
  testInfluxDB3Syntax()
    .then(() => {
      console.log('\n🚀 Syntax verification completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Syntax verification failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testInfluxDB3Syntax };
