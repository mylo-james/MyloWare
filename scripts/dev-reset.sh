#!/bin/bash
set -e

echo "🔄 Resetting MCP Development Environment"
echo ""
echo "⚠️  WARNING: This will DELETE all data in the database!"
echo ""
read -p "Are you sure? (type 'yes' to continue): " -r
echo ""

if [[ ! $REPLY =~ ^yes$ ]]; then
  echo "❌ Cancelled"
  exit 1
fi

# Stop everything
echo "🛑 Stopping all services..."
./scripts/dev-down.sh

# Remove Docker volumes
echo "🗑️  Removing Docker volumes (this deletes all data)..."
docker compose down -v

# Start fresh
echo "🚀 Starting fresh environment..."
./scripts/dev-up.sh

echo ""
echo "✅ Environment reset complete!"

