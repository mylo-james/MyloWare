# MyloWare Agent Notification Scripts

These scripts allow AI agents to send Pushover notifications when they complete their work, so you can be notified of long-running tasks.

## ⚠️ **Temporary Solution**

**This Pushover notification system is a temporary solution until Slack integration is implemented as part of Epic 2: Slack Integration & HITL Framework.**

### **Current Status:**
- **Active:** Pushover notifications for immediate agent communication
- **Future:** Will transition to Slack integration for better team collaboration
- **Timeline:** Temporary until Epic 2 completion

## Setup

### 1. Get Pushover Credentials

1. **Sign up for Pushover:** https://pushover.net/
2. **Get your User Key:** Found on the main page after login
3. **Create an App:** Go to "Your Applications" → "Create an Application"
4. **Get your App Token:** Copy the token from your new app

### 2. Set Environment Variables

```bash
export PUSHOVER_USER_KEY="your_user_key_here"
export PUSHOVER_APP_TOKEN="your_app_token_here"
```

Or add to your `.bashrc` or `.zshrc`:
```bash
echo 'export PUSHOVER_USER_KEY="your_user_key_here"' >> ~/.bashrc
echo 'export PUSHOVER_APP_TOKEN="your_app_token_here"' >> ~/.bashrc
source ~/.bashrc
```

## Usage

### Shell Script (Bash)

```bash
# Basic usage
./scripts/notify-completion.sh "Task completed successfully"

# With priority (0=normal, 1=high, 2=emergency)
./scripts/notify-completion.sh "Database migration completed" "1"

# With custom title
./scripts/notify-completion.sh "All tests passing" "0" "Test Results"
```

### Node.js Script

```bash
# Basic usage
node scripts/notify-completion.js "Task completed successfully"

# With priority
node scripts/notify-completion.js "Deployment successful" "1"

# With custom title
node scripts/notify-completion.js "Build complete" "0" "Build Status"
```

## Priority Levels

- **0 (Normal):** Standard notification
- **1 (High):** High priority notification
- **2 (Emergency):** Emergency notification (requires acknowledgment)

## What Gets Sent

Each notification includes:
- Your custom message
- Current git branch
- Current git commit hash
- Timestamp
- Custom title (optional)

## Example Notifications

### Story Completion
```bash
./scripts/notify-completion.sh "Story 1.2: Database Schema completed successfully" "1" "MyloWare Story Complete"
```

### Test Results
```bash
./scripts/notify-completion.sh "All 47 tests passing, coverage: 89%" "0" "Test Results"
```

### Deployment Status
```bash
./scripts/notify-completion.sh "Production deployment successful - v1.2.3" "1" "Deployment Complete"
```

### Error Notification
```bash
./scripts/notify-completion.sh "Build failed - check logs for details" "2" "Build Error"
```

## Integration with AI Agents

AI agents can use these scripts to notify you when they complete:

1. **Long-running tasks** (database migrations, builds)
2. **Story completions** (when they finish implementing features)
3. **Error conditions** (when something goes wrong)
4. **Deployment status** (when code is deployed)

## Future Migration to Slack

When Epic 2 (Slack Integration) is implemented, this notification system will be enhanced with:

- **Slack channels** for different agent types and workflows
- **Rich message formatting** with attachments and threading
- **Team collaboration** features for better coordination
- **Integration with other development tools** (GitHub, CI/CD, etc.)
- **Better notification management** with search and history

**Current Pushover notifications will continue to work until the Slack integration is fully deployed.**

## Troubleshooting

### "PUSHOVER_USER_KEY not set"
- Make sure you've set the environment variables
- Check with: `echo $PUSHOVER_USER_KEY`

### "Failed to send notification"
- Verify your credentials are correct
- Check your internet connection
- Ensure Pushover service is available

### "Invalid priority"
- Use only 0, 1, or 2 for priority levels
- Default is 0 (normal) if not specified
