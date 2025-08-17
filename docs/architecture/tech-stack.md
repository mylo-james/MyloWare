# Tech Stack

**CRITICAL: This section defines the definitive technology choices for the entire MyloWare platform. All other documents must reference these choices.**

## Cloud Infrastructure

- **Provider:** AWS (Amazon Web Services)
- **Key Services:** ECS Fargate, RDS PostgreSQL, ElastiCache Redis, CloudWatch, IAM, Secrets Manager
- **Deployment Regions:** us-east-1 (primary), us-west-2 (backup)

## Technology Stack Table

| Category              | Technology        | Version | Purpose                      | Rationale                                                                           |
| --------------------- | ----------------- | ------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| **Language**          | TypeScript        | 5.3.3   | Primary development language | Strong typing, excellent tooling, team expertise, type safety for complex workflows |
| **Runtime**           | Node.js           | 20.11.0 | JavaScript runtime           | LTS version, stable performance, wide ecosystem, excellent async support            |
| **Framework**         | NestJS            | 10.3.2  | Backend framework            | Enterprise-ready, dependency injection, decorators, excellent TypeScript support    |
| **Workflow Engine**   | Temporal          | 1.22.0  | Workflow orchestration       | Deterministic execution, retries, idempotency, comprehensive observability          |
| **Database**          | PostgreSQL        | 15.5    | Primary data store           | ACID compliance, JSON support, excellent performance, mature ecosystem              |
| **Event Bus**         | Redis             | 7.2.0   | Message queue and caching    | High performance, streams support, pub/sub, in-memory caching                       |
| **AI Framework**      | OpenAI Agents SDK | 0.1.0   | Agent orchestration          | Standardized agent interfaces, built-in memory, tool integration                    |
| **API Documentation** | OpenAPI           | 3.0.3   | API specification            | Industry standard, excellent tooling, code generation support                       |
| **Testing**           | Jest              | 29.7.0  | Unit and integration testing | Excellent TypeScript support, mocking capabilities, coverage reporting              |
| **Containerization**  | Docker            | 24.0.0  | Application packaging        | Consistent environments, easy deployment, cloud-native ready                        |
| **Orchestration**     | Docker Compose    | 2.20.0  | Local development            | Simple local setup, service coordination, development workflow                      |
| **CI/CD**             | GitHub Actions    | Latest  | Continuous integration       | Native GitHub integration, extensive marketplace, cost-effective                    |
| **Monitoring**        | CloudWatch        | Latest  | Application monitoring       | Native AWS integration, comprehensive metrics, alerting                             |
| **Logging**           | Winston           | 3.11.0  | Application logging          | Structured logging, multiple transports, excellent performance                      |
| **Validation**        | Joi               | 17.11.0 | Input validation             | Schema-based validation, excellent error messages, TypeScript support               |
| **Authentication**    | JWT               | 9.0.2   | Token-based auth             | Stateless, scalable, industry standard                                              |
| **HTTP Client**       | Axios             | 1.6.0   | HTTP requests                | Promise-based, interceptors, excellent error handling                               |
| **Database ORM**      | Prisma            | 5.7.0   | Database access              | Type-safe queries, migrations, excellent TypeScript integration                     |
| **Vector Storage**    | pgvector          | 0.5.0   | Vector embeddings            | PostgreSQL extension, excellent performance, ACID compliance                        |
| **Slack SDK**         | @slack/bolt       | 3.17.0  | Slack integration            | Official SDK, comprehensive features, excellent documentation                       |

**Please review these technology choices carefully. Are there any gaps, disagreements, or clarifications needed? These choices will guide all subsequent development.**
