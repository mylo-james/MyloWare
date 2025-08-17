# Test Strategy and Standards

## Testing Philosophy

- **Approach:** Test-driven development (TDD) for critical business logic
- **Coverage Goals:** 80% code coverage for business logic, 60% for utilities
- **Test Pyramid:** 70% unit tests, 20% integration tests, 10% end-to-end tests

## Test Types and Organization

### Unit Tests

- **Framework:** Jest 29.7.0
- **File Convention:** `*.test.ts` alongside source files
- **Location:** `test/` directory in each package
- **Mocking Library:** Jest built-in mocking
- **Coverage Requirement:** 80% for business logic

**AI Agent Requirements:**

- Generate tests for all public methods
- Cover edge cases and error conditions
- Follow AAA pattern (Arrange, Act, Assert)
- Mock all external dependencies

### Integration Tests

- **Scope:** Service-to-service communication, database operations
- **Location:** `test/integration/` in each package
- **Test Infrastructure:**
  - **Database:** Testcontainers PostgreSQL for integration tests
  - **Redis:** Embedded Redis for testing
  - **External APIs:** WireMock for API stubbing

### End-to-End Tests

- **Framework:** Playwright 1.40.0
- **Scope:** Complete user workflows from Slack to database
- **Environment:** Dedicated test environment with test data
- **Test Data:** Factory pattern with cleanup after each test

## Test Data Management

- **Strategy:** Factory pattern with builders for complex objects
- **Fixtures:** `test/fixtures/` directory with reusable test data
- **Factories:** `test/factories/` directory with object builders
- **Cleanup:** Automatic cleanup after each test using database transactions

## Continuous Testing

- **CI Integration:** Automated testing in GitHub Actions pipeline
- **Performance Tests:** Artillery.js for API performance testing
- **Security Tests:** OWASP ZAP for security vulnerability scanning
