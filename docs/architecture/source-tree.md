# Source Tree

```
myloware/
├── README.md                           # Project overview and setup instructions
├── package.json                        # Root package.json with workspaces
├── docker-compose.yml                  # Local development environment
├── docker-compose.prod.yml             # Production environment
├── .env.example                        # Environment variables template
├── .gitignore                          # Git ignore patterns
├── .eslintrc.js                        # ESLint configuration
├── .prettierrc                         # Prettier configuration
├── tsconfig.json                       # TypeScript configuration
├── jest.config.js                      # Jest test configuration
├── prisma/                             # Database schema and migrations
│   ├── schema.prisma                   # Prisma schema definition
│   ├── migrations/                     # Database migrations
│   └── seed.ts                         # Database seeding script
├── packages/                           # Monorepo packages
│   ├── api-gateway/                    # API Gateway service
│   │   ├── src/
│   │   │   ├── main.ts                 # Application entry point
│   │   │   ├── app.module.ts           # NestJS app module
│   │   │   ├── controllers/            # REST API controllers
│   │   │   ├── services/               # Business logic services
│   │   │   ├── middleware/             # Custom middleware
│   │   │   ├── guards/                 # Authentication guards
│   │   │   ├── interceptors/           # Request/response interceptors
│   │   │   ├── filters/                # Exception filters
│   │   │   ├── decorators/             # Custom decorators
│   │   │   └── types/                  # TypeScript type definitions
│   │   ├── test/                       # Unit and integration tests
│   │   ├── Dockerfile                  # Container definition
│   │   └── package.json                # Package dependencies
│   ├── workflow-service/               # Temporal workflow orchestration
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── workflows/              # Temporal workflow definitions
│   │   │   ├── activities/             # Workflow activities
│   │   │   ├── services/               # Workflow services
│   │   │   └── types/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── agent-orchestration/            # AI agent management
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── agents/                 # Agent implementations
│   │   │   │   ├── record-gen/
│   │   │   │   ├── extractor-llm/
│   │   │   │   ├── json-restyler/
│   │   │   │   ├── schema-guard/
│   │   │   │   ├── persister/
│   │   │   │   └── verifier/
│   │   │   ├── services/               # Agent orchestration services
│   │   │   ├── tools/                  # Agent tools and capabilities
│   │   │   └── types/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── memory-service/                 # Memory and context management
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── services/               # Memory services
│   │   │   ├── repositories/           # Data access layer
│   │   │   ├── models/                 # Memory models
│   │   │   └── types/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── policy-service/                 # Human-in-the-loop policies
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── policies/               # Policy definitions
│   │   │   ├── services/               # Policy services
│   │   │   ├── evaluators/             # Policy evaluators
│   │   │   └── types/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── notification-service/           # Notifications and integrations
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── integrations/           # External integrations
│   │   │   │   ├── slack/
│   │   │   │   ├── email/
│   │   │   │   └── webhooks/
│   │   │   ├── services/               # Notification services
│   │   │   ├── templates/              # Notification templates
│   │   │   └── types/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── database-service/               # Centralized data access
│   │   ├── src/
│   │   │   ├── repositories/           # Repository implementations
│   │   │   ├── migrations/             # Database migrations
│   │   │   ├── models/                 # Data models
│   │   │   └── types/
│   │   ├── test/
│   │   └── package.json
│   ├── event-bus-service/              # Redis Streams event bus
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── publishers/             # Event publishers
│   │   │   ├── consumers/              # Event consumers
│   │   │   ├── schemas/                # Event schemas
│   │   │   └── types/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── run-trace-ui/                   # Web-based observability UI
│   │   ├── src/
│   │   │   ├── components/             # React components
│   │   │   ├── pages/                  # Page components
│   │   │   ├── services/               # API services
│   │   │   ├── hooks/                  # Custom React hooks
│   │   │   ├── utils/                  # Utility functions
│   │   │   └── types/                  # TypeScript types
│   │   ├── public/                     # Static assets
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── shared/                         # Shared utilities and types
│       ├── src/
│       │   ├── types/                  # Shared TypeScript types
│       │   ├── utils/                  # Shared utility functions
│       │   ├── constants/              # Shared constants
│       │   ├── validators/             # Shared validation schemas
│       │   └── decorators/             # Shared decorators
│       ├── test/
│       └── package.json
├── infrastructure/                     # Infrastructure as Code
│   ├── terraform/                      # Terraform configurations
│   │   ├── main.tf                     # Main Terraform configuration
│   │   ├── variables.tf                # Variable definitions
│   │   ├── outputs.tf                  # Output definitions
│   │   ├── providers.tf                # Provider configurations
│   │   ├── modules/                    # Reusable Terraform modules
│   │   │   ├── ecs/                    # ECS Fargate module
│   │   │   ├── rds/                    # RDS PostgreSQL module
│   │   │   ├── redis/                  # ElastiCache Redis module
│   │   │   ├── vpc/                    # VPC and networking module
│   │   │   └── monitoring/             # CloudWatch monitoring module
│   │   └── environments/               # Environment-specific configs
│   │       ├── dev/
│   │       ├── staging/
│   │       └── prod/
│   ├── kubernetes/                     # Kubernetes manifests (alternative)
│   │   ├── namespaces/
│   │   ├── deployments/
│   │   ├── services/
│   │   ├── configmaps/
│   │   ├── secrets/
│   │   └── ingress/
│   └── scripts/                        # Infrastructure scripts
│       ├── deploy.sh                   # Deployment script
│       ├── backup.sh                   # Backup script
│       └── monitoring.sh               # Monitoring setup script
├── ci-cd/                              # CI/CD configurations
│   ├── .github/                        # GitHub Actions workflows
│   │   ├── workflows/
│   │   │   ├── ci.yml                  # Continuous integration
│   │   │   ├── cd-staging.yml          # Staging deployment
│   │   │   ├── cd-prod.yml             # Production deployment
│   │   │   └── security.yml            # Security scanning
│   │   └── actions/                    # Custom GitHub Actions
│   ├── scripts/                        # CI/CD scripts
│   │   ├── build.sh                    # Build script
│   │   ├── test.sh                     # Test script
│   │   ├── deploy.sh                   # Deploy script
│   │   └── rollback.sh                 # Rollback script
│   └── configs/                        # CI/CD configurations
│       ├── sonar-project.properties    # SonarQube configuration
│       └── .dockerignore               # Docker ignore patterns
├── docs/                               # Documentation
│   ├── architecture/                   # Architecture documentation
│   │   ├── overview.md                 # High-level architecture
│   │   ├── components.md               # Component details
│   │   ├── data-models.md              # Data model documentation
│   │   ├── api-spec.md                 # API specifications
│   │   └── deployment.md               # Deployment guide
│   ├── development/                    # Development documentation
│   │   ├── setup.md                    # Development setup
│   │   ├── coding-standards.md         # Coding standards
│   │   ├── testing.md                  # Testing guide
│   │   └── contributing.md             # Contribution guidelines
│   ├── operations/                     # Operations documentation
│   │   ├── monitoring.md               # Monitoring guide
│   │   ├── troubleshooting.md          # Troubleshooting guide
│   │   ├── runbooks/                   # Operational runbooks
│   │   └── security.md                 # Security procedures
│   └── api/                            # API documentation
│       ├── openapi.yaml                # OpenAPI specification
│       └── examples/                   # API examples
├── scripts/                            # Utility scripts
│   ├── setup-dev.sh                    # Development environment setup
│   ├── generate-types.sh               # TypeScript type generation
│   ├── migrate-db.sh                   # Database migration script
│   ├── seed-db.sh                      # Database seeding script
│   └── health-check.sh                 # Health check script
└── tools/                              # Development tools
    ├── postman/                        # Postman collections
    ├── grafana/                        # Grafana dashboards
    └── monitoring/                     # Monitoring configurations
```
