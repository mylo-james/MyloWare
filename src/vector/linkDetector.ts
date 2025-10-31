import { config } from '../config';
import { PromptEmbeddingsRepository } from '../db/repository';
import {
  MemoryLinkRepository,
  type CreateMemoryLinkInput,
  type MemoryLinkType,
} from '../db/linkRepository';

export interface LinkDetectorConfig {
  topK: number;
  similarThreshold: number;
  relatedThreshold: number;
  minStrength: number;
  bidirectional: boolean;
}

export interface LinkCandidate extends CreateMemoryLinkInput {
  similarity: number;
  rank: number;
}

export interface LinkGenerationResult {
  chunkId: string;
  candidates: LinkCandidate[];
  createdCount: number;
}

export interface LinkGenerationSummary {
  totalChunks: number;
  totalCandidates: number;
  totalCreated: number;
  results: LinkGenerationResult[];
}

export interface LinkDetectorDependencies {
  promptRepository?: PromptEmbeddingsRepository;
  linkRepository?: MemoryLinkRepository;
  config?: Partial<LinkDetectorConfig>;
  now?: () => Date;
}

const DEFAULT_CONFIG: LinkDetectorConfig = {
  topK: config.memoryGraph.maxNeighbors,
  similarThreshold: config.memoryGraph.similarThreshold,
  relatedThreshold: config.memoryGraph.relatedThreshold,
  minStrength: config.memoryGraph.minStrength,
  bidirectional: config.memoryGraph.bidirectional,
};

export class LinkDetector {
  private readonly promptRepository: PromptEmbeddingsRepository;
  private readonly settings: LinkDetectorConfig;
  private readonly nowFn: () => Date;

  constructor(dependencies: LinkDetectorDependencies = {}) {
    this.promptRepository = dependencies.promptRepository ?? new PromptEmbeddingsRepository();
    this.settings = {
      ...DEFAULT_CONFIG,
      ...(dependencies.config ?? {}),
    };
    this.nowFn = dependencies.now ?? (() => new Date());
  }

  async generateCandidates(chunkId: string): Promise<LinkCandidate[]> {
    const chunk = await this.promptRepository.getChunkEmbedding(chunkId);
    if (!chunk || chunk.embedding.length === 0) {
      return [];
    }

    const results = await this.promptRepository.search({
      embedding: chunk.embedding,
      limit: this.settings.topK,
      minSimilarity: this.settings.relatedThreshold,
      memoryTypes: undefined,
    });

    const baseMetadata = {
      method: 'auto-similarity',
      detected_at: this.nowFn().toISOString(),
      source_prompt: chunk.promptKey,
    };

    const candidates = new Map<string, LinkCandidate>();

    results.forEach((result, index) => {
      if (result.chunkId === chunkId) {
        return;
      }

      const similarity = clamp(Number(result.similarity ?? 0), 0, 1);
      if (similarity < this.settings.relatedThreshold) {
        return;
      }

      const linkType = determineLinkType(similarity, this.settings);
      if (!linkType) {
        return;
      }

      const strength = Math.max(similarity, this.settings.minStrength);
      const metadata = {
        ...baseMetadata,
        target_prompt: result.promptKey,
        rank: index + 1,
        similarity,
      };

      addCandidate(candidates, {
        sourceChunkId: chunkId,
        targetChunkId: result.chunkId,
        linkType,
        strength,
        metadata,
        similarity,
        rank: index + 1,
      });

      if (this.settings.bidirectional && (linkType === 'similar' || linkType === 'related')) {
        addCandidate(candidates, {
          sourceChunkId: result.chunkId,
          targetChunkId: chunkId,
          linkType,
          strength,
          metadata: {
            ...metadata,
            source_prompt: result.promptKey,
            target_prompt: chunk.promptKey,
            direction: 'reverse',
          },
          similarity,
          rank: index + 1,
        });
      }
    });

    return Array.from(candidates.values()).sort((a, b) => a.rank - b.rank);
  }
}

export class MemoryLinkGenerator {
  private readonly detector: LinkDetector;
  private readonly repository: MemoryLinkRepository;

  constructor(dependencies: LinkDetectorDependencies = {}) {
    this.detector = new LinkDetector(dependencies);
    this.repository = dependencies.linkRepository ?? new MemoryLinkRepository();
  }

  async generateForChunk(chunkId: string): Promise<LinkGenerationResult> {
    const candidates = await this.detector.generateCandidates(chunkId);
    if (candidates.length === 0) {
      return {
        chunkId,
        candidates: [],
        createdCount: 0,
      };
    }

    const createInputs = candidates.map<CreateMemoryLinkInput>((candidate) => ({
      sourceChunkId: candidate.sourceChunkId,
      targetChunkId: candidate.targetChunkId,
      linkType: candidate.linkType,
      strength: candidate.strength,
      metadata: candidate.metadata,
    }));

    const createdCount = await this.repository.upsertLinks(createInputs);
    return {
      chunkId,
      candidates,
      createdCount,
    };
  }

  async generateForChunks(chunkIds: string[]): Promise<LinkGenerationSummary> {
    const results: LinkGenerationResult[] = [];
    let totalCandidates = 0;
    let totalCreated = 0;

    for (const chunkId of chunkIds) {
      const result = await this.generateForChunk(chunkId);
      results.push(result);
      totalCandidates += result.candidates.length;
      totalCreated += result.createdCount;
    }

    return {
      totalChunks: chunkIds.length,
      totalCandidates,
      totalCreated,
      results,
    };
  }
}

function addCandidate(map: Map<string, LinkCandidate>, candidate: LinkCandidate): void {
  const key = `${candidate.sourceChunkId}->${candidate.targetChunkId}:${candidate.linkType}`;
  const existing = map.get(key);
  if (!existing || candidate.strength > existing.strength) {
    map.set(key, candidate);
  }
}

function determineLinkType(similarity: number, config: LinkDetectorConfig): MemoryLinkType | null {
  if (similarity >= config.similarThreshold) {
    return 'similar';
  }
  if (similarity >= config.relatedThreshold) {
    return 'related';
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
