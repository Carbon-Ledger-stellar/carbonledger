#!/bin/bash

echo "🔍 Setting up monitoring and logging..."
echo "========================================"

# Create log directories
mkdir -p logs

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Start ELK stack
echo "📦 Starting ELK stack..."
docker-compose -f docker-compose.monitoring.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 30

# Check service status
echo "📊 Checking service status..."
curl -s http://localhost:9200/_cluster/health | jq '.'
curl -s http://localhost:5601/api/status | jq '.'

echo ""
echo "✅ Monitoring stack is ready!"
echo "   Elasticsearch: http://localhost:9200"
echo "   Kibana: http://localhost:5601"
echo "   Jaeger: http://localhost:16686"
echo ""
echo "📋 Logs are being collected from:"
echo "   TCP: localhost:5000"
echo "   UDP: localhost:5001"
