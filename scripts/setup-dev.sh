#!/bin/bash

# MyloWare Development Environment Setup Script

set -e

echo "🚀 Setting up MyloWare development environment..."

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20.11.0 or higher."
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="20.11.0"

if ! node -e "process.exit(process.version.slice(1).localeCompare('$REQUIRED_VERSION', undefined, {numeric: true}) >= 0 ? 0 : 1)"; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please upgrade to $REQUIRED_VERSION or higher."
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION is compatible"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker 24.0.0 or higher."
    exit 1
fi

echo "✅ Docker is available"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose 2.20.0 or higher."
    exit 1
fi

echo "✅ Docker Compose is available"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Set up environment variables
if [ ! -f .env ]; then
    echo "🔧 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration before continuing"
fi

# Start development services
echo "🐳 Starting development services..."
npm run dev

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 30

# Run database migrations
echo "🗄️  Running database migrations..."
npx prisma migrate dev --name init

# Build packages
echo "🏗️  Building packages..."
npm run build

# Run tests to verify setup
echo "🧪 Running tests to verify setup..."
npm run test

echo "✅ Development environment setup complete!"
echo ""
echo "📖 Next steps:"
echo "   1. Edit .env file with your configuration"
echo "   2. Run 'npm run dev' to start development services"
echo "   3. Run 'npm run test' to run tests"
echo "   4. Visit http://localhost:8080 for Temporal Web UI"
echo ""
echo "📚 Documentation: docs/"
echo "🤝 Contributing: CONTRIBUTING.md"