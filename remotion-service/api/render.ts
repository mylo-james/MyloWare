import path from 'node:path';
import fs from 'node:fs/promises';
import PQueue from 'p-queue';
import { nanoid } from 'nanoid';

// Dynamic import for ESM module
const renderVideoModule = import('../render.mjs');

export type JobStatus = 'queued' | 'rendering' | 'done' | 'error';

export interface RenderRequest {
  run_id?: string;
  template?: string;           // Template name (e.g., "aismr")
  composition_code?: string;   // Custom TSX code (if no template)
  clips: string[];
  objects?: string[];          // Object names for templates
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
}

export class RenderManager {
  private queue: PQueue;
  private jobs: Map<string, RenderJob> = new Map();
  private outputDir: string;
  private publicBaseUrl: string;
  private webhookSecret?: string;

  constructor({ concurrency, outputDir, publicBaseUrl, webhookSecret }: RenderManagerInit) {
    this.queue = new PQueue({ concurrency: Math.max(1, concurrency) });
    this.outputDir = outputDir;
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
    this.webhookSecret = webhookSecret;
  }

  public async enqueue(request: RenderRequest): Promise<RenderJob> {
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
        durationFrames: request.duration_frames,
        fps: request.fps,
        width: request.width,
        height: request.height,
        outputPath,
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
    }
  }

  private async sendCallback(job: RenderJob) {
    if (!job.callbackUrl) return;

    try {
      await fetch(job.callbackUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.webhookSecret ? { 'x-remotion-signature': this.webhookSecret } : {}),
        },
        body: JSON.stringify({
          job_id: job.id,
          run_id: job.runId,
          status: job.status,
          output_url: job.outputUrl,
          error: job.error,
        }),
      });
    } catch (error) {
      console.error('Failed to send webhook', error);
    }
  }
}
