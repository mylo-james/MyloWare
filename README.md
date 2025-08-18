# MyloWare

MyloWare is an AI-powered workflow automation platform that enables intelligent task orchestration through human-in-the-loop (HITL) policies and advanced agent frameworks.

## 🚀 Quick Start

### Prerequisites

- Node.js 20.11.0 or higher
- Docker 24.0.0 or higher
- Docker Compose 2.20.0 or higher
- Git

### Local Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/myloware/myloware.git
   cd myloware
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start development services**

   ```bash
   npm run dev
   ```

5. **Initialize database**

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

6. **Build and start services**
   ```bash
   npm run build
   npm start
   ```

## 🏗️ Architecture

MyloWare is built as a microservices monorepo with the following key components:

### Core Services

- **API Gateway** - Central API routing and authentication
- **Workflow Service** - Temporal-based workflow orchestration
- **Agent Orchestration** - AI agent management and execution
- **Memory Service** - Vector-based memory and context management
- **Policy Service** - Human-in-the-loop policy enforcement
- **Notification Service** - Multi-channel notifications (Slack, email, webhooks)
- **Database Service** - Centralized data access layer
- **Event Bus Service** - Redis Streams-based event messaging

### Technology Stack

- **Language:** TypeScript 5.3.3
- **Runtime:** Node.js 20.11.0
- **Framework:** NestJS 10.3.2
- **Database:** PostgreSQL 15.5 with pgvector 0.5.0
- **Event Bus:** Redis 7.2.0
- **Workflow Engine:** Temporal 1.22.0
- **Testing:** Jest 29.7.0
- **Containerization:** Docker 24.0.0

## 📁 Project Structure

```
myloware/
├── packages/           # Microservices packages
│   ├── api-gateway/    # API Gateway service
│   ├── workflow-service/
│   ├── agent-orchestration/
│   ├── memory-service/
│   ├── policy-service/
│   ├── notification-service/
│   ├── database-service/
│   ├── event-bus-service/
│   ├── run-trace-ui/   # Observability UI
│   └── shared/         # Shared utilities and types
├── prisma/             # Database schema and migrations
├── scripts/            # Utility scripts
├── .github/            # CI/CD workflows
└── docs/               # Documentation
```

## 🛠️ Development

### Available Scripts

- `npm run build` - Build all packages
- `npm run test` - Run all tests
- `npm run lint` - Lint all code
- `npm run format` - Format all code
- `npm run dev` - Start development environment
- `npm run dev:down` - Stop development environment

### Testing

We use Jest for testing with 80% coverage requirements:

```bash
# Run all tests
npm run test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Code Quality

- **ESLint** - Linting with TypeScript rules
- **Prettier** - Code formatting
- **Jest** - Unit and integration testing
- **Snyk** - Security vulnerability scanning
- **Husky** - Git hooks for automated quality checks
- **lint-staged** - Run linting/formatting only on staged files

### Git Hooks

Pre-commit and pre-push hooks are automatically installed to ensure code quality:

- **Pre-commit:** Runs ESLint and Prettier on staged files
- **Pre-push:** Runs full build and test suite before pushing

## 🚀 Deployment

### Staging

Automatic deployment to staging on push to `develop` branch.

### Production

Automatic deployment to production on tag creation (e.g., `v1.0.0`).

## 📚 Documentation

- [Architecture Overview](docs/architecture/index.md)
- [API Documentation](docs/architecture/rest-api-spec.md)
- [Development Guide](CONTRIBUTING.md)
- [Deployment Guide](docs/architecture/infrastructure-and-deployment.md)

## 🤝 Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚙️ Configuration

### Optional External Services

The following external services require additional configuration:

- **Codecov** - Set `CODECOV_TOKEN` secret for coverage reporting
- **Snyk** - Set `SNYK_ORG_ID` (use `mylo-james`) and `SNYK_INTEGRATION_ID` secrets for enhanced security scanning
- **AWS** - Configure AWS credentials for production deployment

### Slack Setup (Epic 2)

1. Create Slack App and add scopes: `chat:write`, `chat:write.customize`, `commands`, `reactions:write`, `users:read` (optional: `chat:write.public`, `channels:read`).
2. Enable Socket Mode and generate App Token with `connections:write`.
3. Install app to workspace; capture `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`.
4. Set env vars in `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
```

5. Create channels and invite the bot: `#mylo-control`, `#mylo-approvals`, `#mylo-feed`.
6. Start services and verify:

```bash
curl -X POST http://localhost:3004/api/v1/notifications/slack/test \
  -H 'Content-Type: application/json' \
  -d '{"channel":"#mylo-control","text":"MyloWare connectivity test"}'

curl http://localhost:3004/api/v1/notifications/slack/health
```

#### Troubleshooting

- 426 Upgrade Required: You likely hit the MCP WebSocket port (8081). Use the HTTP API port 3004 instead.
- Socket Mode not active: Ensure `SLACK_APP_TOKEN` is set and the service has been restarted; check `slack.isSocketModeActive` at `/api/v1/notifications/slack/health`.
- Auth errors: Verify `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are correct and the bot is installed in the workspace.
- No messages in channel: Confirm the bot is invited to the channel and the channel name is correct (e.g., `#mylo-control`).

**Security scanning** uses multiple tools:

- **npm audit** - Built-in Node.js dependency scanning
- **CodeQL** - GitHub's built-in code security analysis
- **Trivy** - Comprehensive vulnerability scanner
- **Snyk** - Advanced security scanning (requires org/integration IDs)

## 🆘 Support

For support and questions:

- Create an issue in the GitHub repository
- Check the [documentation](docs/)
- Review the [troubleshooting guide](docs/troubleshooting.md)
