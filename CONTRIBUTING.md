# Contributing to MyloWare

Thank you for your interest in contributing to MyloWare! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Development Environment Setup

1. **Prerequisites**
   - Node.js 20.11.0+
   - Docker 24.0.0+
   - Git

2. **Setup**

   ```bash
   git clone https://github.com/myloware/myloware.git
   cd myloware
   npm install
   cp .env.example .env
   npm run dev
   ```

3. **Verify Setup**
   ```bash
   npm run test
   npm run lint
   ```

## 📋 Development Workflow

### Branch Strategy

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - Feature development branches
- `hotfix/*` - Critical production fixes

### Making Changes

1. **Create a feature branch**

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the coding standards
   - Write tests for new functionality
   - Update documentation as needed

3. **Test your changes**

   ```bash
   npm run lint
   npm run test
   npm run build
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## 📝 Coding Standards

### TypeScript Guidelines

- Use strict TypeScript configuration
- Explicit return types for all functions
- No `any` types (use `unknown` if needed)
- Prefer interfaces over types for object shapes

### Naming Conventions

- **Files:** kebab-case (`user-service.ts`)
- **Classes:** PascalCase (`UserService`)
- **Functions:** camelCase (`getUserById`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_RETRY_ATTEMPTS`)
- **Interfaces:** PascalCase with I prefix (`IUserRepository`)

### Code Organization

- One class/interface per file
- Group related functionality in modules
- Use barrel exports (`index.ts`) for clean imports
- Follow repository pattern for data access

### Testing Standards

- Test file convention: `*.test.ts`
- 80% minimum code coverage
- Unit tests for all business logic
- Integration tests for API endpoints
- Mock all external dependencies

### Documentation

- JSDoc comments for all public APIs
- README files for each package
- Architecture decision records (ADRs) for significant changes

## 🔍 Code Review Process

### Pull Request Requirements

- [ ] All tests pass
- [ ] Code coverage meets 80% threshold
- [ ] Linting passes without errors
- [ ] Documentation updated
- [ ] Security scan passes
- [ ] At least one approving review

### Review Checklist

- Code follows established patterns
- Error handling is comprehensive
- Security considerations addressed
- Performance implications considered
- Breaking changes documented

## 🏗️ Architecture Guidelines

### Service Design

- Each service should have a single responsibility
- Use dependency injection for testability
- Implement health checks for all services
- Follow 12-factor app principles

### Database Design

- Use Prisma for all database interactions
- Follow repository pattern
- Include proper indexing strategies
- Use transactions for multi-step operations

### API Design

- RESTful endpoints where appropriate
- Consistent error response format
- Proper HTTP status codes
- API versioning strategy

## 🐛 Bug Reports

When reporting bugs, please include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js version, etc.)
- Relevant logs or error messages

## 💡 Feature Requests

For feature requests, please provide:

- Clear use case description
- Proposed solution approach
- Alternative solutions considered
- Impact on existing functionality

## 🚨 Security

- Never commit secrets or credentials
- Use environment variables for configuration
- Follow OWASP security guidelines
- Report security vulnerabilities privately

## 📞 Getting Help

- Check existing documentation first
- Search existing issues
- Ask questions in discussions
- Join our developer community

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.
