#!/usr/bin/env node

/**
 * Test script for WAL Management System
 * This script tests the WAL management endpoints and functionality
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3002';
const API_BASE = `${BASE_URL}/wal-management`;

async function testWALManagement() {
  console.log('🧪 Testing WAL Management System...\n');

  try {
    // Test 1: Get WAL Health
    console.log('1️⃣ Testing WAL Health Endpoint...');
    const healthResponse = await axios.get(`${API_BASE}/health`);
    console.log('✅ WAL Health Response:', JSON.stringify(healthResponse.data, null, 2));
    console.log('');

    // Test 2: Get Checkpoint Status
    console.log('2️⃣ Testing Checkpoint Status Endpoint...');
    const checkpointResponse = await axios.get(`${API_BASE}/checkpoint-status`);
    console.log('✅ Checkpoint Status Response:', JSON.stringify(checkpointResponse.data, null, 2));
    console.log('');

    // Test 3: Get WAL Statistics
    console.log('3️⃣ Testing WAL Statistics Endpoint...');
    const statsResponse = await axios.get(`${API_BASE}/stats`);
    console.log('✅ WAL Statistics Response:', JSON.stringify(statsResponse.data, null, 2));
    console.log('');

    // Test 4: Force Checkpoint
    console.log('4️⃣ Testing Force Checkpoint Endpoint...');
    const checkpointTriggerResponse = await axios.post(`${API_BASE}/checkpoint`);
    console.log('✅ Force Checkpoint Response:', JSON.stringify(checkpointTriggerResponse.data, null, 2));
    console.log('');

    // Test 5: Wait and check health again
    console.log('5️⃣ Waiting 10 seconds and checking health again...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const healthAfterResponse = await axios.get(`${API_BASE}/health`);
    console.log('✅ WAL Health After Checkpoint:', JSON.stringify(healthAfterResponse.data, null, 2));
    console.log('');

    console.log('🎉 All WAL Management tests completed successfully!');
    
    // Summary
    console.log('\n📊 WAL Management System Summary:');
    console.log(`   - Health Status: ${healthAfterResponse.data.healthStatus}`);
    console.log(`   - WAL Files: ${healthAfterResponse.data.fileCount}`);
    console.log(`   - WAL Size: ${healthAfterResponse.data.totalSizeGB.toFixed(2)}GB`);
    console.log(`   - Last Checkpoint: ${healthAfterResponse.data.lastCheckpoint || 'Never'}`);
    console.log(`   - Recommendations: ${healthAfterResponse.data.recommendations.join(', ')}`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    
    process.exit(1);
  }
}

// Check if API is running
async function checkAPIAvailability() {
  try {
    await axios.get(`${BASE_URL}/api/v1/health`);
    return true;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  console.log('🚀 WAL Management System Test');
  console.log('==============================\n');
  
  // Check if API is available
  console.log('🔍 Checking API availability...');
  const apiAvailable = await checkAPIAvailability();
  
  if (!apiAvailable) {
    console.error('❌ API is not available. Please ensure your NestJS application is running on port 3002.');
    console.error('   Start the application with: docker-compose up -d');
    process.exit(1);
  }
  
  console.log('✅ API is available. Starting tests...\n');
  
  // Run tests
  await testWALManagement();
}

// Run the main function
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { testWALManagement, checkAPIAvailability };
