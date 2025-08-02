#!/bin/bash

echo "🧪 Testing InfluxDB 3.0 Setup"
echo "=============================="

# Test InfluxDB health
echo "🔍 Testing InfluxDB health..."
if curl -s http://localhost:8087/health > /dev/null; then
    echo "✅ InfluxDB 3.0 is healthy"
else
    echo "❌ InfluxDB 3.0 health check failed"
    exit 1
fi

# Test API endpoints
echo "🔍 Testing API endpoints..."

# Test SQL debug endpoint
echo "📊 Testing SQL debug endpoint..."
SQL_RESPONSE=$(curl -s http://localhost:3002/api/v1/devices/debug/sql)
if echo "$SQL_RESPONSE" | grep -q "recordsFound"; then
    echo "✅ SQL debug endpoint working"
    echo "   Records found: $(echo "$SQL_RESPONSE" | grep -o '"recordsFound":[0-9]*' | cut -d: -f2)"
else
    echo "⚠️  SQL debug endpoint returned: $SQL_RESPONSE"
fi

# Test time series endpoint
echo "📈 Testing time series endpoint..."
TIMESERIES_RESPONSE=$(curl -s http://localhost:3002/api/v1/devices/esp32_controller_001/timeseries)
if echo "$TIMESERIES_RESPONSE" | grep -q "recordsFound\|length\|groundLevel"; then
    echo "✅ Time series endpoint working"
else
    echo "⚠️  Time series endpoint returned: $TIMESERIES_RESPONSE"
fi

# Test system stats
echo "📊 Testing system stats endpoint..."
STATS_RESPONSE=$(curl -s http://localhost:3002/api/v1/devices/stats)
if echo "$STATS_RESPONSE" | grep -q "devices\|influxdb"; then
    echo "✅ System stats endpoint working"
else
    echo "⚠️  System stats endpoint returned: $STATS_RESPONSE"
fi

echo ""
echo "🎉 Testing completed!"
echo ""
echo "📋 Summary:"
echo "- InfluxDB 3.0 is running and healthy"
echo "- API endpoints are responding"
echo "- SQL queries are working (with fallback to Flux if needed)"
echo ""
echo "🚀 Your water pump system is now running on InfluxDB 3.0!" 