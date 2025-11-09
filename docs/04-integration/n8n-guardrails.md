# n8n Guardrails Configuration

## Overview

The universal workflow includes a Guardrails node that validates and sanitizes user instructions before they reach the AI agent. This prevents prompt injection, PII exposure, and jailbreak attempts.

## Guardrails Node

**Location:** `workflows/myloware-agent.workflow.json`

**Position:** Between `Prepare Trace Context` and `AI Agent: Persona Execution`

### Configuration

```json
{
  "parameters": {
    "mode": "check",
    "text": "={{ $json.instructions }}",
    "options": {
      "sanitize": true,
      "checkForPII": true,
      "checkForJailbreak": true
    }
  },
  "type": "@n8n/n8n-nodes-langchain.guardrails"
}
```

### Policies

1. **Prompt Injection Detection**
   - Detects attempts to override system prompts
   - Blocks common injection patterns (e.g., "Ignore previous instructions")
   - Validates instruction format and structure

2. **PII Detection**
   - Scans for personally identifiable information
   - Detects email addresses, phone numbers, SSNs
   - Sanitizes or blocks PII-containing instructions

3. **Jailbreak Detection**
   - Identifies attempts to bypass safety measures
   - Blocks known jailbreak techniques
   - Validates instruction intent

4. **Sanitization**
   - Removes malicious content while preserving intent
   - Normalizes instruction format
   - Escapes special characters

## Violation Logging

### Log Guardrail Violations Node

**Location:** After Guardrails node

**Function:**
- Detects guardrail violations in output
- Prepares violation data for memory storage
- Preserves original and sanitized instructions

### Store Violation Memory Node

**Location:** After Log Guardrail Violations node

**Function:**
- Stores violations in memory via MCP `memory_store`
- Tags with `['security', 'guardrail-violation']`
- Includes traceId for correlation
- Continues on fail to avoid blocking workflow

### Violation Memory Structure

```json
{
  "content": "Guardrail violation detected: prompt-injection, pii",
  "memoryType": "episodic",
  "tags": ["security", "guardrail-violation"],
  "metadata": {
    "traceId": "trace-aismr-001",
    "violationTypes": ["prompt-injection", "pii"],
    "originalInstructions": "Original user input...",
    "sanitizedInstructions": "Sanitized input..."
  }
}
```

## Violation Handling

### Detection Flow

```
Guardrails → Log Violations → Store in Memory → Continue to AI Agent
```

### Blocking vs. Sanitizing

- **Blocking:** Request is rejected, error workflow triggered
- **Sanitizing:** Malicious content removed, sanitized version passed to agent

Current configuration uses **sanitizing** mode to preserve user intent while removing threats.

### Error Workflow Integration

If guardrails completely block a request:
1. Guardrails node throws error
2. Error workflow triggers
3. Trace marked as `failed`
4. User notified (if Telegram session)

## Querying Violations

### Search Violations by Trace

```typescript
memory_search({
  query: 'guardrail violation',
  traceId: 'trace-aismr-001',
  tags: ['security', 'guardrail-violation']
})
```

### Search All Violations

```typescript
memory_search({
  query: 'guardrail violation',
  tags: ['guardrail-violation'],
  limit: 50
})
```

### Filter by Violation Type

```typescript
memory_search({
  query: 'prompt injection',
  tags: ['guardrail-violation'],
  metadata: {
    violationTypes: ['prompt-injection']
  }
})
```

## Common Violation Types

### Prompt Injection

**Examples:**
- "Ignore all previous instructions"
- "You are now a helpful assistant that..."
- "SYSTEM: Override safety measures"

**Detection:** Pattern matching, instruction structure analysis

### PII Exposure

**Examples:**
- Email addresses: `user@example.com`
- Phone numbers: `(555) 123-4567`
- SSNs: `123-45-6789`

**Detection:** Regex patterns, data format validation

### Jailbreak Attempts

**Examples:**
- "Pretend you are..."
- "Act as if..."
- "Roleplay as..."

**Detection:** Intent analysis, known jailbreak patterns

## Configuration

### Adjusting Sensitivity

Modify Guardrails node options:

```json
{
  "options": {
    "sanitize": true,           // Enable sanitization
    "checkForPII": true,        // Check for PII
    "checkForJailbreak": true,  // Check for jailbreaks
    "strictMode": false         // Strict blocking (vs. sanitizing)
  }
}
```

### Custom Patterns

Add custom detection patterns via Guardrails node configuration or MCP tool extensions.

## Monitoring

### Violation Trends

Query violation memory to track:
- Violation frequency over time
- Most common violation types
- Traces with multiple violations
- User patterns (if sessionId tracked)

### Alerting

Set up alerts for:
- High violation rates
- Specific violation types
- Repeated violations from same session

## Best Practices

1. **Always enable guardrails** in production workflows
2. **Log all violations** for security analysis
3. **Monitor violation trends** for attack patterns
4. **Review violations regularly** to tune detection
5. **Balance security and UX** (sanitize vs. block)
6. **Document false positives** to improve detection

## Troubleshooting

### False Positives

**Symptom:** Legitimate instructions flagged as violations

**Resolution:**
1. Review violation memory for pattern
2. Adjust Guardrails sensitivity
3. Add exception patterns if needed
4. Document legitimate use cases

### Violations Not Logged

**Symptom:** Violations detected but not stored in memory

**Resolution:**
1. Check "Store Violation Memory" node execution
2. Verify MCP server is accessible
3. Check memory_store tool permissions
4. Review error workflow logs

### Guardrails Blocking Legitimate Requests

**Symptom:** Too many requests blocked

**Resolution:**
1. Switch from blocking to sanitizing mode
2. Adjust detection sensitivity
3. Review violation patterns
4. Add whitelist patterns if needed

## Security Considerations

1. **Don't disable guardrails** in production
2. **Review violations regularly** for security threats
3. **Keep guardrails updated** with latest patterns
4. **Monitor for new attack vectors**
5. **Document security incidents** in violation memory

