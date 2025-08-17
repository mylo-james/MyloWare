#!/bin/bash

# MyloWare Agent Completion Notification Script
# Usage: ./scripts/notify-completion.sh "Task completed successfully" "high"
# 
# This script sends a Pushover notification when AI agents complete their work.
# Requires PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN environment variables.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    print_status "Loading environment variables from .env file..."
    export $(grep -v '^#' .env | xargs)
fi

# Default values
MESSAGE="${1:-Agent task completed}"
PRIORITY="${2:-0}"  # 0=normal, 1=high, 2=emergency
TITLE="${3:-MyloWare Agent Notification}"

# Check if required environment variables are set
if [ -z "$PUSHOVER_USER_KEY" ]; then
    print_error "PUSHOVER_USER_KEY environment variable is not set"
    print_warning "Please set your Pushover User Key:"
    print_warning "export PUSHOVER_USER_KEY='your_user_key_here'"
    exit 1
fi

if [ -z "$PUSHOVER_APP_TOKEN" ]; then
    print_error "PUSHOVER_APP_TOKEN environment variable is not set"
    print_warning "Please set your Pushover App Token:"
    print_warning "export PUSHOVER_APP_TOKEN='your_app_token_here'"
    exit 1
fi

# Validate priority
if [[ ! "$PRIORITY" =~ ^[0-2]$ ]]; then
    print_warning "Invalid priority '$PRIORITY'. Using normal priority (0)"
    PRIORITY="0"
fi

# Get current timestamp and git info
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Build notification message
FULL_MESSAGE="$MESSAGE

Branch: $GIT_BRANCH
Commit: $GIT_COMMIT
Time: $TIMESTAMP"

print_status "Sending Pushover notification..."
print_status "Title: $TITLE"
print_status "Priority: $PRIORITY"
print_status "Message: $MESSAGE"

# Send Pushover notification
RESPONSE=$(curl -s \
    -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "token=$PUSHOVER_APP_TOKEN" \
    -d "user=$PUSHOVER_USER_KEY" \
    -d "title=$TITLE" \
    -d "message=$FULL_MESSAGE" \
    -d "priority=$PRIORITY" \
    -d "sound=cosmic" \
    https://api.pushover.net/1/messages.json)

# Check if the request was successful
if echo "$RESPONSE" | grep -q '"status":1'; then
    print_status "Notification sent successfully!"
    print_status "Response: $RESPONSE"
else
    print_error "Failed to send notification"
    print_error "Response: $RESPONSE"
    exit 1
fi
