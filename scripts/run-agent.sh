#!/bin/bash

# MyloWare Background Agent Runner
# Usage: ./scripts/run-agent.sh [command]
# Example: ./scripts/run-agent.sh "npm run notify:success"

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}[AGENT]${NC} $1"
}

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_error ".env file not found!"
    print_warning "Please create a .env file with your Pushover credentials:"
    print_warning "  PUSHOVER_USER_KEY=your_user_key_here"
    print_warning "  PUSHOVER_APP_TOKEN=your_app_token_here"
    exit 1
fi

# Validate required environment variables
print_status "Validating environment variables..."

# Source the .env file to check variables
set -a
source .env
set +a

if [ -z "$PUSHOVER_USER_KEY" ]; then
    print_error "PUSHOVER_USER_KEY not set in .env file"
    exit 1
fi

if [ -z "$PUSHOVER_APP_TOKEN" ]; then
    print_error "PUSHOVER_APP_TOKEN not set in .env file"
    exit 1
fi

print_status "Environment variables validated ✓"

# Get the command to run (default to notification test)
AGENT_COMMAND=${1:-"npm run notify:success"}

print_header "Starting MyloWare Background Agent..."
print_status "Command: $AGENT_COMMAND"

# Build the agent image if it doesn't exist
if ! docker images myloware-agent:latest >/dev/null 2>&1; then
    print_status "Building agent Docker image..."
    docker build -f Dockerfile.agents -t myloware-agent:latest .
fi

# Run the agent container with environment variables
print_status "Running agent container..."
docker run --rm \
    --env-file .env \
    -v "$(pwd)":/workspace \
    -w /workspace \
    myloware-agent:latest \
    sh -c "$AGENT_COMMAND"

print_header "Agent execution completed!"