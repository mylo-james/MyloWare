import { MemoryLinkRepository, type MemoryLinkType } from '../db/linkRepository';

export interface GraphSeed {
  chunkId: string;
  similarity: number;
}

export interface GraphPathStep {
  from: string;
  to: string;
  linkType: MemoryLinkType;
  strength: number;
}

export interface GraphExpansionOptions {
  maxHops: number;
  minLinkStrength: number;
  maxPerNode: number;
  maxResults: number;
  seedWeight: number;
  linkWeight: number;
}

export interface GraphExpansionMatch {
  chunkId: string;
  seedChunkId: string;
  seedSimilarity: number;
  hopCount: number;
  linkStrength: number;
  seedContribution: number;
  linkContribution: number;
  score: number;
  path: GraphPathStep[];
}

interface QueueItem {
  chunkId: string;
  hop: number;
  path: GraphPathStep[];
}

export async function expandGraphSeeds(params: {
  seeds: GraphSeed[];
  linkRepository: MemoryLinkRepository;
  options: GraphExpansionOptions;
}): Promise<GraphExpansionMatch[]> {
  const { seeds, linkRepository, options } = params;

  if (!Array.isArray(seeds) || seeds.length === 0) {
    return [];
  }

  const normalizedOptions = normalizeOptions(options);
  const matches = new Map<string, GraphExpansionMatch>();

  for (const seed of seeds) {
    if (!seed || !isFiniteNumber(seed.similarity) || seed.similarity <= 0) {
      continue;
    }

    const visitedDepth = new Map<string, number>();
    visitedDepth.set(seed.chunkId, 0);

    const queue: QueueItem[] = [
      {
        chunkId: seed.chunkId,
        hop: 0,
        path: [],
      },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.hop >= normalizedOptions.maxHops) {
        continue;
      }

      const neighbors = await linkRepository.getLinkedChunks(current.chunkId, {
        limit: normalizedOptions.maxPerNode,
        minStrength: normalizedOptions.minLinkStrength,
      });

      for (const neighbor of neighbors) {
        const targetId = neighbor.targetChunkId;
        if (!targetId || targetId === seed.chunkId) {
          continue;
        }

        if (current.path.some((step) => step.to === targetId)) {
          continue;
        }

        const hop = current.hop + 1;
        const existingDepth = visitedDepth.get(targetId);
        if (existingDepth !== undefined && existingDepth <= hop) {
          continue;
        }
        visitedDepth.set(targetId, hop);

        const linkStrength = clamp01(Number(neighbor.strength ?? 0));
        if (linkStrength < normalizedOptions.minLinkStrength) {
          continue;
        }

        const seedContribution = seed.similarity * normalizedOptions.seedWeight;
        const linkContribution = (linkStrength * normalizedOptions.linkWeight) / hop;
        const score = seedContribution + linkContribution;

        const path: GraphPathStep[] = [
          ...current.path,
          {
            from: current.chunkId,
            to: targetId,
            linkType: neighbor.linkType,
            strength: linkStrength,
          },
        ];

        const existing = matches.get(targetId);
        if (!existing || score > existing.score) {
          matches.set(targetId, {
            chunkId: targetId,
            seedChunkId: seed.chunkId,
            seedSimilarity: seed.similarity,
            hopCount: hop,
            linkStrength,
            seedContribution,
            linkContribution,
            score,
            path,
          });
        }

        if (hop < normalizedOptions.maxHops) {
          queue.push({
            chunkId: targetId,
            hop,
            path,
          });
        }
      }
    }
  }

  return Array.from(matches.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, normalizedOptions.maxResults);
}

function normalizeOptions(options: GraphExpansionOptions): GraphExpansionOptions {
  const maxHops = Math.max(1, Math.floor(options.maxHops));
  const maxPerNode = Math.max(1, Math.floor(options.maxPerNode));
  const maxResults = Math.max(1, Math.floor(options.maxResults));
  const seedWeight = clamp01(options.seedWeight);
  const linkWeight = clamp01(options.linkWeight);
  const weightTotal = seedWeight + linkWeight || 1;

  return {
    maxHops,
    maxPerNode,
    maxResults,
    minLinkStrength: clamp01(options.minLinkStrength),
    seedWeight: seedWeight / weightTotal,
    linkWeight: linkWeight / weightTotal,
  };
}

function clamp01(value: number): number {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
