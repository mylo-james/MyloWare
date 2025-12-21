import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import PQueue from 'p-queue';
import { nanoid } from 'nanoid';

// Dynamic import for ESM module
const renderVideoModule = import('../render.mjs');

export type JobStatus = 'queued' | 'rendering' | 'done' | 'error';

export interface RenderRequest {
  run_id?: string;
  template?: string;           // Template name (e.g., "aismr", "motivational")
  composition_code?: string;   // Custom TSX code (if no template)
  clips: string[];
  objects?: string[];          // Object names for AISMR template
  texts?: string[];            // Text overlays for motivational template
  duration_frames: number;
  fps: number;
  width: number;
  height: number;
  callback_url?: string;
}

export interface RenderJob {
  id: string;
  runId?: string;
  template?: string;
  status: JobStatus;
  progress: number;
  outputPath?: string;
  outputUrl?: string;
  error?: string | null;
  callbackUrl?: string;
  createdAt: number;
}

interface RenderManagerInit {
  concurrency: number;
  outputDir: string;
  publicBaseUrl: string;
  webhookSecret?: string;
  maxJobs?: number;
  jobTtlSeconds?: number;
  outputTtlSeconds?: number;
  renderTimeoutMs?: number;
  callbackAllowlist?: string[];
  callbackTimeoutMs?: number;
}

export class RenderManager {
  private queue: PQueue;
  private jobs: Map<string, RenderJob> = new Map();
  private outputDir: string;
  private publicBaseUrl: string;
  private webhookSecret?: string;
  private maxJobs: number;
  private jobTtlMs: number;
  private outputTtlMs: number;
  private renderTimeoutMs: number;
  private callbackAllowlist: string[];
  private callbackTimeoutMs: number;

  constructor({
    concurrency,
    outputDir,
    publicBaseUrl,
    webhookSecret,
    maxJobs = 1000,
    jobTtlSeconds = 6 * 60 * 60,
    outputTtlSeconds = 24 * 60 * 60,
    renderTimeoutMs = 15 * 60 * 1000,
    callbackAllowlist = [],
    callbackTimeoutMs = 5000,
  }: RenderManagerInit) {
    this.queue = new PQueue({ concurrency: Math.max(1, concurrency) });
    this.outputDir = outputDir;
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
    this.webhookSecret = webhookSecret;
    this.maxJobs = Math.max(100, Number.isFinite(maxJobs) ? maxJobs : 1000);
    const jobTtlMs = Number.isFinite(jobTtlSeconds) ? jobTtlSeconds * 1000 : 6 * 60 * 60 * 1000;
    const outputTtlMs = Number.isFinite(outputTtlSeconds)
      ? outputTtlSeconds * 1000
      : 24 * 60 * 60 * 1000;
    this.jobTtlMs = Math.max(60_000, jobTtlMs);
    this.outputTtlMs = Math.max(0, outputTtlMs);
    this.renderTimeoutMs = Math.max(10_000, Number(renderTimeoutMs) || 0);
    this.callbackAllowlist = callbackAllowlist.map((v) => v.toLowerCase());
    this.callbackTimeoutMs = Math.max(1000, Number(callbackTimeoutMs) || 5000);
  }

  public async enqueue(request: RenderRequest): Promise<RenderJob> {
    if (this.jobs.size >= this.maxJobs) {
      throw new Error('Render queue is full');
    }
    const id = nanoid();
    const job: RenderJob = {
      id,
      runId: request.run_id,
      template: request.template,
      status: 'queued',
      progress: 0,
      error: null,
      callbackUrl: request.callback_url,
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    await fs.mkdir(this.outputDir, { recursive: true });

    void this.pruneStale();
    void this.queue.add(() => this.processJob(job, request));
    return job;
  }

  public getJob(id: string): RenderJob | undefined {
    return this.jobs.get(id);
  }

  public getHealth() {
    return {
      queued: this.queue.size,
      pending: this.queue.pending,
      totalJobs: this.jobs.size,
    };
  }

  private pruneJobs(now: number) {
    const cutoff = now - this.jobTtlMs;
    for (const [id, job] of this.jobs.entries()) {
      if ((job.status === 'done' || job.status === 'error') && job.createdAt < cutoff) {
        this.jobs.delete(id);
      }
    }

    if (this.jobs.size <= this.maxJobs) return;

    const candidates = Array.from(this.jobs.values())
      .filter((job) => job.status === 'done' || job.status === 'error')
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const job of candidates) {
      this.jobs.delete(job.id);
      if (this.jobs.size <= this.maxJobs) return;
    }
  }

  private async pruneOutputs(now: number) {
    if (this.outputTtlMs <= 0) return;
    try {
      const entries = await fs.readdir(this.outputDir);
      await Promise.all(entries.map(async (name) => {
        if (!name.endsWith('.mp4')) return;
        const filePath = path.join(this.outputDir, name);
        try {
          const stat = await fs.stat(filePath);
          if (now - stat.mtimeMs > this.outputTtlMs) {
            await fs.unlink(filePath);
          }
        } catch {
          return;
        }
      }));
    } catch {
      return;
    }
  }

  private async pruneStale() {
    const now = Date.now();
    this.pruneJobs(now);
    await this.pruneOutputs(now);
  }

  private async processJob(job: RenderJob, request: RenderRequest) {
    job.status = 'rendering';
    const outputPath = path.join(this.outputDir, `${job.id}.mp4`);

    try {
      const { renderVideo } = await renderVideoModule;

      await renderVideo({
        jobId: job.id,
        template: request.template,
        compositionCode: request.composition_code,
        clips: request.clips,
        objects: request.objects,
        texts: request.texts,
        durationFrames: request.duration_frames,
        fps: request.fps,
        width: request.width,
        height: request.height,
        outputPath,
        timeoutMs: this.renderTimeoutMs,
        onProgress: (progress: number) => {
          job.progress = progress;
        },
      });

      job.status = 'done';
      job.outputPath = outputPath;
      job.outputUrl = `${this.publicBaseUrl}/output/${path.basename(outputPath)}`;
      job.progress = 1;

      if (job.callbackUrl) {
        await this.sendCallback(job);
      }
    } catch (error) {
      console.error('Render failed', error);
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      job.progress = 0;

      if (job.callbackUrl) {
        await this.sendCallback(job);
      }
    } finally {
      void this.pruneStale();
    }
  }

  private async sendCallback(job: RenderJob) {
    if (!job.callbackUrl) return;
    if (!this.isCallbackAllowed(job.callbackUrl)) {
      console.error('Callback URL not allowlisted, skipping', job.callbackUrl);
      return;
    }

    try {
      const body = JSON.stringify({
        job_id: job.id,
        run_id: job.runId,
        status: job.status,
        output_url: job.outputUrl,
        error: job.error,
      });

      const signature =
        this.webhookSecret
          ? `sha512=${crypto.createHmac('sha512', this.webhookSecret).update(body).digest('hex')}`
          : undefined;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.callbackTimeoutMs);
      try {
        await fetch(job.callbackUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(signature ? { 'x-remotion-signature': signature } : {}),
          },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      console.error('Failed to send webhook', error);
    }
  }

  private isCallbackAllowed(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      const protocol = parsed.protocol.toLowerCase();
      const hostname = parsed.hostname.toLowerCase();

      if (!['http:', 'https:'].includes(protocol)) return false;
      if (protocol === 'http:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return false;
      }

      if (this.callbackAllowlist.length === 0) {
        return hostname === 'localhost' || hostname === '127.0.0.1';
      }

      return this.callbackAllowlist.some((allowed) => {
        const dom = allowed.replace(/^\.+|\.+$/g, '');
        if (!dom) return false;
        return hostname === dom || hostname.endsWith(`.${dom}`);
      });
    } catch {
      return false;
    }
  }
}
