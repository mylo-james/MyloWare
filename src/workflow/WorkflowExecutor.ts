import type {
  WorkflowDefinition,
  WorkflowStep,
  ExecutionContext,
  StepResult,
  ValidationResult,
} from '../types/workflow';

/**
 * WorkflowExecutor - Interprets and validates workflow definitions loaded from RAG
 *
 * This executor:
 * - Parses workflow definitions from RAG search results
 * - Validates workflow structure
 * - Resolves variable references in step parameters
 * - Provides execution context for n8n agents
 * - Tracks step execution results
 */
export class WorkflowExecutor {
  private workflow: WorkflowDefinition | null = null;
  private context: ExecutionContext;
  private stepResults: Map<string, StepResult> = new Map();
  private executionOrder: WorkflowStep[] = [];

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  /**
   * Load workflow definition from RAG search result
   */
  loadWorkflowFromRAG(ragResult: {
    content: string;
    metadata?: Record<string, unknown>;
  }): void {
    try {
      // Parse JSON content from RAG result
      const parsed = JSON.parse(ragResult.content) as WorkflowDefinition;

      // Validate structure
      this.validateWorkflowDefinition(parsed);

      this.workflow = parsed;

      // Build execution order based on dependencies
      this.buildExecutionOrder();
    } catch (error) {
      throw new Error(
        `Failed to load workflow from RAG: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Load workflow definition directly (for testing)
   */
  loadWorkflow(definition: WorkflowDefinition): void {
    this.validateWorkflowDefinition(definition);
    this.workflow = definition;
    this.buildExecutionOrder();
  }

  /**
   * Get the loaded workflow definition
   */
  getWorkflow(): WorkflowDefinition | null {
    return this.workflow;
  }

  /**
   * Get execution order of steps
   */
  getExecutionOrder(): WorkflowStep[] {
    return this.executionOrder;
  }

  /**
   * Get next step to execute
   */
  getNextStep(completedStepIds: string[]): WorkflowStep | null {
    if (!this.workflow) {
      return null;
    }

    for (const step of this.executionOrder) {
      // Check if step is already completed
      if (completedStepIds.includes(step.id)) {
        continue;
      }

      // Check if dependencies are met
      if (step.dependsOn && step.dependsOn.length > 0) {
        const allDependenciesMet = step.dependsOn.every((depId) =>
          completedStepIds.includes(depId),
        );
        if (!allDependenciesMet) {
          continue;
        }
      }

      return step;
    }

    return null;
  }

  /**
   * Resolve variable references in a template string
   */
  resolveVariables(template: string): string {
    if (!template) {
      return template;
    }

    // Replace ${context.*} with actual context values
    return template.replace(/\$\{context\.(\w+)\}/g, (match, key) => {
      const value = this.context[key as keyof ExecutionContext];
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Resolve variable references in params object
   */
  resolveParams(params: Record<string, unknown>): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        resolved[key] = this.resolveVariables(value);
      } else if (Array.isArray(value)) {
        resolved[key] = value.map((item) => {
          if (typeof item === 'string') {
            return this.resolveVariables(item);
          }
          return item;
        });
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveParams(value as Record<string, unknown>);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Get MCP call parameters with variables resolved
   */
  getMCPCallParams(step: WorkflowStep): Record<string, unknown> {
    if (!step.mcp_call) {
      throw new Error(`Step ${step.id} does not have mcp_call defined`);
    }

    return this.resolveParams(step.mcp_call.params);
  }

  /**
   * Get LLM generation prompt with variables resolved
   */
  getLLMPrompt(step: WorkflowStep): string {
    if (!step.llm_generation) {
      throw new Error(`Step ${step.id} does not have llm_generation defined`);
    }

    return this.resolveVariables(step.llm_generation.prompt);
  }

  /**
   * Record step execution result
   */
  recordStepResult(stepId: string, result: StepResult): void {
    this.stepResults.set(stepId, result);
  }

  /**
   * Get step execution result
   */
  getStepResult(stepId: string): StepResult | undefined {
    return this.stepResults.get(stepId);
  }

  /**
   * Get all step results
   */
  getAllStepResults(): Map<string, StepResult> {
    return this.stepResults;
  }

  /**
   * Validate step result against validation rules
   */
  validateStepResult(step: WorkflowStep, result: StepResult): ValidationResult[] {
    if (!step.validation || !result.output) {
      return [];
    }

    const validationResults: ValidationResult[] = [];

    // Schema validation
    if (step.validation.schema) {
      // Basic schema check (would need JSON Schema validator in production)
      const passed = this.validateSchema(result.output, step.validation.schema.schema);
      validationResults.push({
        rule: 'schema',
        passed,
        error: passed ? undefined : 'Output does not match required schema',
      });
    }

    // Uniqueness validation (requires comparison with other results)
    if (step.validation.uniqueness) {
      const passed = this.validateUniqueness(
        result.output,
        step.validation.uniqueness.against,
        step.validation.uniqueness.threshold,
      );
      validationResults.push({
        rule: 'uniqueness',
        passed,
        error: passed
          ? undefined
          : 'Output is too similar to existing content (uniqueness threshold exceeded)',
      });
    }

    // Timing validation (for AISMR scripts)
    if (step.validation.timing) {
      const passed = this.validateTiming(result.output, step.validation.timing);
      validationResults.push({
        rule: 'timing',
        passed,
        error: passed ? undefined : 'Timing requirements not met',
      });
    }

    return validationResults;
  }

  /**
   * Check if workflow execution is complete
   */
  isComplete(completedStepIds: string[]): boolean {
    if (!this.workflow) {
      return false;
    }

    return this.executionOrder.every((step) => completedStepIds.includes(step.id));
  }

  /**
   * Get final output formatted according to workflow output_format
   */
  getFinalOutput(): unknown {
    if (!this.workflow) {
      return null;
    }

    const outputs: Record<string, unknown> = {};

    // Collect outputs from all steps
    for (const [stepId, result] of this.stepResults.entries()) {
      if (result.success && result.output) {
        const step = this.executionOrder.find((s) => s.id === stepId);
        if (step) {
          // Use storeAs key if specified, otherwise use step id
          const key = step.mcp_call?.storeAs || step.llm_generation?.storeAs || step.id;
          outputs[key] = result.output;
        }
      }
    }

    return outputs;
  }

  /**
   * Validate workflow definition structure
   */
  private validateWorkflowDefinition(definition: WorkflowDefinition): void {
    if (!definition.title) {
      throw new Error('Workflow definition must have a title');
    }

    if (definition.memoryType !== 'procedural') {
      throw new Error('Workflow definition memoryType must be "procedural"');
    }

    if (!definition.project || definition.project.length === 0) {
      throw new Error('Workflow definition must have at least one project');
    }

    if (!definition.workflow) {
      throw new Error('Workflow definition must have a workflow object');
    }

    if (!definition.workflow.name) {
      throw new Error('Workflow must have a name');
    }

    if (!definition.workflow.steps || definition.workflow.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }

    // Validate each step
    for (const step of definition.workflow.steps) {
      this.validateStep(step);
    }

    // Check for circular dependencies
    this.checkCircularDependencies(definition.workflow.steps);
  }

  /**
   * Validate a single workflow step
   */
  private validateStep(step: WorkflowStep): void {
    if (!step.id) {
      throw new Error('Step must have an id');
    }

    if (!step.type) {
      throw new Error(`Step ${step.id} must have a type`);
    }

    // Validate type-specific requirements
    switch (step.type) {
      case 'mcp_call':
        if (!step.mcp_call) {
          throw new Error(`Step ${step.id} of type mcp_call must have mcp_call defined`);
        }
        if (!step.mcp_call.tool) {
          throw new Error(`Step ${step.id} mcp_call must have a tool name`);
        }
        break;

      case 'parallel':
        if (!step.parallel_calls || step.parallel_calls.length === 0) {
          throw new Error(`Step ${step.id} of type parallel must have parallel_calls defined`);
        }
        break;

      case 'llm_generation':
        if (!step.llm_generation) {
          throw new Error(`Step ${step.id} of type llm_generation must have llm_generation defined`);
        }
        if (!step.llm_generation.prompt) {
          throw new Error(`Step ${step.id} llm_generation must have a prompt`);
        }
        break;

      case 'api_call':
        if (!step.api_call) {
          throw new Error(`Step ${step.id} of type api_call must have api_call defined`);
        }
        if (!step.api_call.url) {
          throw new Error(`Step ${step.id} api_call must have a url`);
        }
        break;

      case 'conditional':
        if (!step.conditional) {
          throw new Error(`Step ${step.id} of type conditional must have conditional defined`);
        }
        break;
    }
  }

  /**
   * Check for circular dependencies in workflow steps
   */
  private checkCircularDependencies(steps: WorkflowStep[]): void {
    const stepIds = new Set(steps.map((s) => s.id));

    for (const step of steps) {
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!stepIds.has(depId)) {
            throw new Error(`Step ${step.id} depends on unknown step ${depId}`);
          }
        }
      }
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (stepId: string): boolean => {
      visited.add(stepId);
      recStack.add(stepId);

      const step = steps.find((s) => s.id === stepId);
      if (step?.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!visited.has(depId)) {
            if (hasCycle(depId)) {
              return true;
            }
          } else if (recStack.has(depId)) {
            return true;
          }
        }
      }

      recStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (hasCycle(step.id)) {
          throw new Error(`Circular dependency detected in workflow steps`);
        }
      }
    }
  }

  /**
   * Build execution order based on dependencies
   */
  private buildExecutionOrder(): void {
    if (!this.workflow) {
      return;
    }

    const steps = [...this.workflow.workflow.steps];
    const ordered: WorkflowStep[] = [];
    const added = new Set<string>();

    while (ordered.length < steps.length) {
      let progress = false;

      for (const step of steps) {
        if (added.has(step.id)) {
          continue;
        }

        // Check if dependencies are met
        const depsMet =
          !step.dependsOn ||
          step.dependsOn.length === 0 ||
          step.dependsOn.every((depId) => added.has(depId));

        if (depsMet) {
          ordered.push(step);
          added.add(step.id);
          progress = true;
        }
      }

      if (!progress) {
        throw new Error('Cannot resolve step dependencies - possible circular dependency');
      }
    }

    this.executionOrder = ordered;
  }

  /**
   * Validate output against JSON schema (simplified)
   */
  private validateSchema(output: unknown, schema: unknown): boolean {
    // In production, use a proper JSON Schema validator like ajv
    // For now, do basic type checking
    if (!schema || typeof schema !== 'object') {
      return true; // No schema to validate against
    }

    const schemaObj = schema as Record<string, unknown>;
    if (schemaObj.type === 'object' && typeof output !== 'object') {
      return false;
    }

    if (schemaObj.type === 'array' && !Array.isArray(output)) {
      return false;
    }

    if (schemaObj.type === 'string' && typeof output !== 'string') {
      return false;
    }

    if (schemaObj.type === 'number' && typeof output !== 'number') {
      return false;
    }

    return true;
  }

  /**
   * Validate uniqueness (simplified - would need similarity scoring in production)
   */
  private validateUniqueness(
    output: unknown,
    against: string[],
    threshold = 0.7,
  ): boolean {
    // In production, would compute similarity scores
    // For now, return true (would need access to referenced step results)
    return true;
  }

  /**
   * Validate timing requirements
   */
  private validateTiming(
    output: unknown,
    timing: { runtime?: number; whisperTiming?: number; maxHands?: number },
  ): boolean {
    if (typeof output !== 'object' || output === null) {
      return false;
    }

    const obj = output as Record<string, unknown>;
    const compliance = obj.compliance_notes as Record<string, unknown> | undefined;

    if (!compliance) {
      return false;
    }

    if (timing.runtime !== undefined) {
      const runtime = compliance.runtime as number | undefined;
      if (runtime === undefined || Math.abs(runtime - timing.runtime) > 0.1) {
        return false;
      }
    }

    if (timing.whisperTiming !== undefined) {
      const whisperTiming = compliance.whisper_timing as number | undefined;
      if (whisperTiming === undefined || Math.abs(whisperTiming - timing.whisperTiming) > 0.1) {
        return false;
      }
    }

    if (timing.maxHands !== undefined) {
      const handsCount = compliance.hands_count as number | undefined;
      if (handsCount === undefined || handsCount > timing.maxHands) {
        return false;
      }
    }

    return true;
  }
}

