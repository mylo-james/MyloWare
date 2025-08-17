# MyloWare Background Agents - Docker Setup

## Quick Start

### 1. Setup Environment Variables

Make sure your `.env` file has your real Pushover credentials:

```bash
# Copy from example and edit
cp .env.example .env

# Add your Pushover credentials to .env:
PUSHOVER_USER_KEY=your_real_user_key_here
PUSHOVER_APP_TOKEN=your_real_app_token_here
```

### 2. Run Agents with Docker

#### Option A: Using the Helper Script (Recommended)

```bash
# Test notification
./scripts/run-agent.sh "npm run notify:success"

# Custom notification
./scripts/run-agent.sh "npm run notify 'Background agent working!' '1' 'Agent Test'"

# Run specific agent command
./scripts/run-agent.sh "node -e \"console.log('Agent task here')\""
```

#### Option B: Using Docker Compose

```bash
# Run notification test
docker-compose -f docker-compose.agents.yml up notification-test

# Start persistent agent container
docker-compose -f docker-compose.agents.yml up -d myloware-agent

# Execute commands in running agent
docker-compose -f docker-compose.agents.yml exec myloware-agent npm run notify:success
```

#### Option C: Direct Docker Commands

```bash
# Build agent image
docker build -f Dockerfile.agents -t myloware-agent:latest .

# Run with environment file
docker run --rm --env-file .env myloware-agent:latest npm run notify:success

# Run with mounted workspace
docker run --rm --env-file .env -v $(pwd):/workspace -w /workspace myloware-agent:latest npm run notify:story
```

## Available Notification Commands

```bash
npm run notify:success    # Success notification
npm run notify:error      # Error notification  
npm run notify:story      # Story completion
npm run notify "message" "priority" "title"  # Custom notification
```

## Environment Variables Required

- `PUSHOVER_USER_KEY` - Your Pushover user key
- `PUSHOVER_APP_TOKEN` - Your Pushover application token

## Features

- ✅ **Automatic .env loading** - Reads your local environment variables
- ✅ **Git integration** - Includes branch and commit info in notifications
- ✅ **Volume mounting** - Access to workspace files
- ✅ **Security** - Runs as non-root user
- ✅ **Health checks** - Validates notification system availability

## Troubleshooting

### "PUSHOVER_USER_KEY not set"
- Check your `.env` file has the correct variables
- Ensure the `.env` file is in the project root

### "application token is invalid"
- Verify your Pushover credentials are correct
- Check you're using the right User Key and App Token

### Docker build fails
- Ensure Docker is running
- Try: `docker system prune` to clean up