export type MemoryType = 'episodic' | 'semantic' | 'procedural';

export interface Memory {
  id: string;
  content: string;
  summary: string | null;
  embedding: number[];
  memoryType: MemoryType;
  persona: string[];
  project: string[];
  tags: string[];
  relatedTo: string[];
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
  accessCount: number;
  metadata: Record<string, unknown>;
}

export interface MemorySearchParams {
  query: string;
  memoryTypes?: MemoryType[];
  persona?: string;
  project?: string;
  limit?: number;
  minSimilarity?: number;
  temporalBoost?: boolean;
  expandGraph?: boolean;
  maxHops?: number;
}

export interface MemoryStoreParams {
  content: string;
  memoryType: MemoryType;
  persona?: string[];
  project?: string[];
  tags?: string[];
  relatedTo?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  memories: Memory[];
  totalFound: number;
  searchTime: number;
}

export interface MemoryEvolveParams {
  memoryId: string;
  updates: {
    addTags?: string[];
    removeTags?: string[];
    addLinks?: string[];
    removeLinks?: string[];
    updateSummary?: string;
  };
}

export interface MemoryEvolveResult {
  success: boolean;
  memory: Memory;
  changes: string[];
}

