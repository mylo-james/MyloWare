# Coding Standards

## Core Standards

- **Languages & Runtimes:** TypeScript 5.3.3, Node.js 20.11.0
- **Style & Linting:** ESLint with TypeScript rules, Prettier for formatting
- **Test Organization:** Jest for testing with `*.test.ts` file convention

## Naming Conventions

| Element    | Convention               | Example              |
| ---------- | ------------------------ | -------------------- |
| Files      | kebab-case               | `user-service.ts`    |
| Classes    | PascalCase               | `UserService`        |
| Functions  | camelCase                | `getUserById`        |
| Constants  | UPPER_SNAKE_CASE         | `MAX_RETRY_ATTEMPTS` |
| Interfaces | PascalCase with I prefix | `IUserRepository`    |
| Enums      | PascalCase               | `UserStatus`         |

## Critical Rules

- **Security:** Never log sensitive data (passwords, tokens, PII)
- **Error Handling:** Always use try-catch blocks for async operations
- **Type Safety:** Strict TypeScript configuration with no implicit any
- **API Responses:** Use standardized ApiResponse wrapper for all API responses
- **Database Access:** Use repository pattern, never direct ORM calls in controllers
- **Environment Variables:** Validate all environment variables on startup
- **Dependencies:** Pin exact versions in package.json, use lockfiles

## Language-Specific Guidelines

### TypeScript Specifics

- **Strict Mode:** Enable all strict TypeScript compiler options
- **Type Definitions:** Create interfaces for all external API responses
- **Async/Await:** Prefer async/await over Promises.then()
- **Null Safety:** Use optional chaining and nullish coalescing operators
