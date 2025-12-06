import path from 'node:path';
import express, { Request, Response } from 'express';
import { RenderManager, RenderRequest } from './render';

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT ?? 3001);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const manager = new RenderManager({
  concurrency: CONCURRENCY,
  outputDir: OUTPUT_DIR,
  publicBaseUrl: PUBLIC_BASE_URL,
  webhookSecret: WEBHOOK_SECRET,
});

app.use('/output', express.static(OUTPUT_DIR));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ...manager.getHealth() });
});

app.post('/api/render', async (req: Request, res: Response) => {
  const body: Partial<RenderRequest> = req.body ?? {};

  // Must have either template or composition_code
  const hasTemplate = body.template && typeof body.template === 'string';
  const hasCode = body.composition_code && typeof body.composition_code === 'string';
  
  if (!hasTemplate && !hasCode) {
    res.status(400).json({ error: 'Either template or composition_code is required' });
    return;
  }

  if (!Array.isArray(body.clips) || body.clips.length === 0) {
    res.status(400).json({ error: 'clips must be a non-empty array' });
    return;
  }

  // Support objects at top level OR inside input_props (for tool compatibility)
  const inputProps = (body as any).input_props ?? {};
  const objects = body.objects ?? inputProps.objects;

  // Support both duration_frames and duration_seconds
  const fps = body.fps ?? 30;
  let durationFrames = body.duration_frames;
  if (!durationFrames && (body as any).duration_seconds) {
    durationFrames = Math.round((body as any).duration_seconds * fps);
  }
  durationFrames = durationFrames ?? 300;

  const request: RenderRequest = {
    run_id: body.run_id,
    template: body.template,
    composition_code: body.composition_code,
    clips: body.clips,
    objects: objects,
    duration_frames: durationFrames,
    fps: fps,
    width: body.width ?? 1080,
    height: body.height ?? 1920,
    callback_url: body.callback_url,
  };

  try {
    const job = await manager.enqueue(request);
    res.status(202).json({ 
      job_id: job.id, 
      status: job.status,
      template: job.template,
    });
  } catch (error) {
    console.error('Failed to enqueue render', error);
    res.status(500).json({ error: 'Failed to queue render' });
  }
});

app.get('/api/render/:jobId', (req: Request, res: Response) => {
  const job = manager.getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }

  res.json({
    status: job.status,
    progress: job.progress,
    output_url: job.outputUrl,
    template: job.template,
    error: job.error,
  });
});

app.listen(PORT, () => {
  console.log(`Remotion render service listening on port ${PORT}`);
});
