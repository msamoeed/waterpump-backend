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
    
    // Test 2: Time-based query with LIMIT (using small time range to avoid file limit)
    console.log('\n📊 Test 2: Time-based query with LIMIT (small time range)...');
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    
    const timeQuery = `
      SELECT time, device_id, level_percent 
      FROM water_levels 
      WHERE time >= '${oneHourAgo.toISOString()}' 
        AND time <= '${now.toISOString()}'
      ORDER BY time DESC 
      LIMIT 10
    `;
    console.log(`Query: ${timeQuery.trim()}`);
    
    const timeResult = [];
    for await (const row of client.query(timeQuery)) {
      timeResult.push(row);
    }
    console.log(`✅ Time query successful: ${timeResult.length} results`);
    
    // Test 3: Aggregation with time_bucket (InfluxDB 3.3 syntax) - small time range
    console.log('\n📊 Test 3: Aggregation with time_bucket (small time range)...');
    const aggQuery = `
      SELECT 
        time_bucket(interval '1 hour', time) as time,
        device_id,
        AVG(level_percent) as avg_level
      FROM water_levels 
      WHERE time >= '${oneHourAgo.toISOString()}' 
        AND time <= '${now.toISOString()}'
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
    
    // Test 4: Complex query with multiple conditions (small time range)
    console.log('\n📊 Test 4: Complex query with multiple conditions (small time range)...');
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
        AND time >= '${oneHourAgo.toISOString()}'
        AND time <= '${now.toISOString()}'
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
    
    // Test 7: Test with even smaller time range (last 15 minutes)
    console.log('\n📊 Test 7: Very small time range query (15 minutes)...');
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    
    const smallTimeQuery = `
      SELECT time, device_id, level_percent
      FROM water_levels 
      WHERE time >= '${fifteenMinutesAgo.toISOString()}' 
        AND time <= '${now.toISOString()}'
      ORDER BY time DESC 
      LIMIT 5
    `;
    console.log(`Query: ${smallTimeQuery.trim()}`);
    
    const smallTimeResult = [];
    for await (const row of client.query(smallTimeQuery)) {
      smallTimeResult.push(row);
    }
    console.log(`✅ Small time range query successful: ${smallTimeResult.length} results`);
    
    console.log('\n🎉 All InfluxDB 3.3 syntax tests passed!');
    console.log('\n📋 Summary:');
    console.log('- Basic SELECT queries: ✅');
    console.log('- Time-based queries (1 hour): ✅');
    console.log('- Aggregation with time_bucket: ✅');
    console.log('- Complex WHERE conditions: ✅');
    console.log('- Data writing: ✅');
    console.log('- Data reading: ✅');
    console.log('- Small time range queries (15 min): ✅');
    
    console.log('\n💡 Key Insights:');
    console.log('- Using small time ranges prevents file limit errors');
    console.log('- time_bucket function works correctly with InfluxDB 3.3');
    console.log('- All SQL syntax is compatible');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    
    if (error.message.includes('file limit') || error.message.includes('parquet files')) {
      console.log('\n💡 Hint: File limit exceeded. This test uses small time ranges to avoid this issue.');
      console.log('In production, use aggregation windows or split large queries into smaller time chunks.');
    }
    
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
