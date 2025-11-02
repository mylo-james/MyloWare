const CANDIDATE_KEYS = [
  'args',
  'input',
  'parameters',
  'payload',
  'data',
  'value',
  'body',
  'request',
  'requestBody',
  'params',
];

const ENVELOPE_KEYS = ['requestInfo', '_meta'];

interface ExtractOptions {
  allowedKeys?: readonly string[];
  maxDepth?: number;
}

export function extractToolArgs(rawArgs: unknown, options: ExtractOptions = {}): Record<string, unknown> {
  const { allowedKeys, maxDepth = 6 } = options;
  const allowedSet = allowedKeys ? new Set(allowedKeys) : undefined;
  const visited = new Set<unknown>();

  const candidate = findCandidate(rawArgs, {
    allowedSet,
    maxDepth,
    visited,
  });

  if (!isPlainObject(candidate)) {
    return {};
  }

  if (!allowedSet) {
    return candidate;
  }

  return Object.fromEntries(
    Object.entries(candidate).filter(([key]) => allowedSet.has(key)),
  );
}

interface FindCandidateState {
  allowedSet?: Set<string>;
  maxDepth: number;
  visited: Set<unknown>;
}

function findCandidate(value: unknown, state: FindCandidateState, depth = 0): Record<string, unknown> | null {
  if (depth > state.maxDepth) {
    return null;
  }

  if (!isPlainObject(value)) {
    return null;
  }

  if (state.visited.has(value)) {
    return null;
  }
  state.visited.add(value);

  if (state.allowedSet && matchesAllowedKeys(value, state.allowedSet)) {
    return value;
  }

  for (const key of ENVELOPE_KEYS) {
    if (key in value) {
      const nested = findCandidate(value[key], state, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  for (const key of CANDIDATE_KEYS) {
    if (key in value) {
      const nested = findCandidate(value[key], state, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  for (const nested of Object.values(value)) {
    const result = findCandidate(nested, state, depth + 1);
    if (result) {
      return result;
    }
  }

  if (!state.allowedSet && depth > 0) {
    return value;
  }

  return depth === 0 ? value : null;
}

function matchesAllowedKeys(object: Record<string, unknown>, allowedSet?: Set<string>): boolean {
  if (!allowedSet) {
    return true;
  }

  if (Object.keys(object).length === 0) {
    return true;
  }

  return Object.keys(object).some((key) => allowedSet.has(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

