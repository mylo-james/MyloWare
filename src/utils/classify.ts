import type {
  ClassificationResult,
  ClassificationCandidates,
} from '../types/knowledge.js';
import { getOpenAIClient } from '../clients/openai.js';
import { withRetry } from './retry.js';
import { logger } from './logger.js';

/**
 * Classification error
 */
export class ClassificationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ClassificationError';
  }
}

/**
 * Configuration for classification
 */
export interface ClassifyConfig {
  /** Model to use for classification */
  model: string;
  /** Temperature for classification (0 = deterministic) */
  temperature: number;
  /** Max tokens for response */
  maxTokens: number;
  /** Max input text length */
  maxInputLength: number;
  /** Max retries on failure */
  maxRetries: number;
}

/**
 * Default classification configuration
 */
export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = {
  model: 'gpt-4o-mini',
  temperature: 0,
  maxTokens: 200,
  maxInputLength: 6000,
  maxRetries: 3,
};

/**
 * Build the system prompt for classification
 *
 * @param candidates - Available personas and projects
 * @returns System prompt for LLM
 */
export function buildClassificationPrompt(
  candidates: ClassificationCandidates
): string {
  return `You are a knowledge classifier. Analyze the given text and determine which personas and projects it applies to.

Available personas: ${candidates.personas.join(', ')}
Available projects: ${candidates.projects.join(', ')}

Return ONLY valid JSON in this exact format:
{
  "personas": ["persona1", "persona2"],
  "projects": ["project1", "project2"],
  "memoryType": "semantic" | "procedural" | "episodic"
}

Rules:
- personas: Array of persona names that would find this knowledge useful (can be empty)
- projects: Array of project names this knowledge relates to (can be empty)
- memoryType: "semantic" for facts/knowledge, "procedural" for how-to/workflows, "episodic" for events/logs
- Return only the JSON object, no other text`;
}

/**
 * Extract JSON from LLM response (handles markdown code blocks)
 *
 * @param rawContent - Raw LLM response
 * @returns Extracted JSON string
 */
export function extractJSON(rawContent: string): string {
  const trimmed = rawContent.trim();

  // Try to find JSON in markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }

  // Try to find raw JSON
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return trimmed;
}

/**
 * Validate and sanitize classification result
 *
 * @param parsed - Parsed classification result
 * @param candidates - Available candidates for validation
 * @returns Validated classification result
 */
export function validateClassification(
  parsed: unknown,
  candidates: ClassificationCandidates
): ClassificationResult {
  if (!parsed || typeof parsed !== 'object') {
    return {
      personas: [],
      projects: [],
      memoryType: 'semantic',
    };
  }

  const result = parsed as Record<string, unknown>;

  // Validate personas
  const personas = Array.isArray(result.personas)
    ? result.personas
        .filter((p): p is string => typeof p === 'string')
        .filter((p) => candidates.personas.includes(p))
    : [];

  // Validate projects
  const projects = Array.isArray(result.projects)
    ? result.projects
        .filter((p): p is string => typeof p === 'string')
        .filter((p) => candidates.projects.includes(p))
    : [];

  // Validate memory type
  const memoryType =
    result.memoryType === 'procedural' || result.memoryType === 'episodic'
      ? result.memoryType
      : 'semantic';

  return {
    personas,
    projects,
    memoryType,
  };
}

/**
 * Classify a text chunk using LLM
 *
 * Determines which personas and projects the text applies to,
 * and what type of memory it represents.
 *
 * @param text - Text chunk to classify
 * @param candidates - Available personas and projects
 * @param config - Classification configuration
 * @returns Classification result with personas, projects, and memory type
 * @throws {ClassificationError} If classification fails after retries
 */
export async function classifyTargets(
  text: string,
  candidates: ClassificationCandidates,
  config: Partial<ClassifyConfig> = {}
): Promise<ClassificationResult> {
  // Validate inputs
  if (!text || typeof text !== 'string') {
    throw new ClassificationError('Text must be a non-empty string');
  }

  if (!candidates.personas || !Array.isArray(candidates.personas)) {
    throw new ClassificationError('Candidates must include personas array');
  }

  if (!candidates.projects || !Array.isArray(candidates.projects)) {
    throw new ClassificationError('Candidates must include projects array');
  }

  // Merge with defaults
  const {
    model,
    temperature,
    maxTokens,
    maxInputLength,
    maxRetries,
  } = {
    ...DEFAULT_CLASSIFY_CONFIG,
    ...config,
  };

  return withRetry(
    async () => {
      const openai = getOpenAIClient();

      // Build prompt
      const systemPrompt = buildClassificationPrompt(candidates);

      // Truncate input if needed
      const userContent = text.slice(0, maxInputLength);

      // Call LLM
      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `Classify this text:\n\n${userContent}`,
          },
        ],
        temperature,
        max_tokens: maxTokens,
      });

      const rawContent = response.choices[0].message.content?.trim() || '{}';

      // Extract JSON
      const jsonStr = extractJSON(rawContent);

      // Parse and validate
      try {
        const parsed = JSON.parse(jsonStr);
        const validated = validateClassification(parsed, candidates);

        logger.debug(
          {
            textLength: text.length,
            personas: validated.personas,
            projects: validated.projects,
            memoryType: validated.memoryType,
          },
          'classify_targets: classification complete'
        );

        return validated;
      } catch (parseError) {
        logger.warn(
          {
            rawContent,
            error: parseError instanceof Error ? parseError.message : String(parseError),
          },
          'classify_targets: failed to parse classification JSON, using fallback'
        );

        // Return fallback classification
        return {
          personas: [],
          projects: [],
          memoryType: 'semantic',
        };
      }
    },
    {
      maxRetries,
      retryable: (error: unknown) => {
        if (error instanceof Error) {
          const message = error.message.toLowerCase();
          return (
            message.includes('rate_limit') ||
            message.includes('rate limit') ||
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('503') ||
            message.includes('502')
          );
        }
        return false;
      },
    }
  );
}

