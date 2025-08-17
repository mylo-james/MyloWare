# Epic 4: Docs Extract & Verify Workflow

**Goal**: Implement the core MVP workflow that demonstrates the platform's capabilities through document extraction and verification, establishing the foundation for more complex workflows.

## Story 4.1: RecordGen Agent Implementation

As a developer,
I want a RecordGen agent that can generate synthetic documents and ground truth,
so that the platform can be tested with controlled, known data.

**Acceptance Criteria:**

1. RecordGen agent implemented as CPU/tool-only agent
2. Synthetic document generation with various formats (invoice, ticket, status)
3. Ground truth generation for validation
4. Document variety and edge case coverage
5. Performance optimization for rapid generation

## Story 4.2: ExtractorLLM Agent Implementation

As a developer,
I want an ExtractorLLM agent that can extract structured data from documents,
so that the platform can convert unstructured content into actionable information.

**Acceptance Criteria:**

1. ExtractorLLM agent using gpt-4o-mini model
2. JSON schema validation for extracted outputs
3. Citation tracking for used memory sources
4. Token budget enforcement (input ≤ 800, output ≤ 200)
5. Error handling for extraction failures

## Story 4.3: JsonRestyler Agent Implementation

As a developer,
I want a JsonRestyler agent that can normalize and validate JSON outputs,
so that the platform can ensure consistent data formats without introducing new facts.

**Acceptance Criteria:**

1. JsonRestyler agent implemented as CPU/tool-only agent
2. JSON normalization and validation
3. Schema compliance checking
4. No new fact introduction (strict validation)
5. Error reporting for invalid JSON

## Story 4.4: SchemaGuard Agent Implementation

As a developer,
I want a SchemaGuard agent that can compare outputs to ground truth,
so that the platform can validate extraction accuracy and quality.

**Acceptance Criteria:**

1. SchemaGuard agent implemented as CPU/tool-only agent
2. Ground truth comparison with tolerance for dates and amounts
3. Failure classification (missing_field, wrong_type, wrong_value, etc.)
4. Accuracy metrics calculation
5. Detailed error reporting for debugging

## Story 4.5: Persister and Verifier Agents

As a developer,
I want Persister and Verifier agents to complete the workflow,
so that extracted data can be stored and verified for consistency.

**Acceptance Criteria:**

1. Persister agent for storing extracted data to memory
2. Verifier agent for consistency and hash checking
3. Data integrity validation
4. Storage optimization and indexing
5. Verification reporting and metrics

## Story 4.6: Workflow Integration and Testing

As a developer,
I want the complete workflow integrated and tested,
so that the platform can reliably execute end-to-end document processing.

**Acceptance Criteria:**

1. Complete workflow DAG implementation in Temporal
2. Golden set testing (12 docs) with 100% pass rate
3. Jailbreak set testing for prompt injection resistance
4. Load testing with parallel execution
5. Chaos testing for failure scenarios
