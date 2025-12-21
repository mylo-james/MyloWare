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
const API_SECRET = process.env.REMOTION_API_SECRET;
const ALLOW_COMPOSITION_CODE = process.env.REMOTION_ALLOW_COMPOSITION_CODE === 'true';
const SANDBOX_ENABLED = process.env.REMOTION_SANDBOX_ENABLED === 'true';
const SANDBOX_STRICT = process.env.REMOTION_SANDBOX_STRICT === 'true';
const OUTPUT_PUBLIC = process.env.REMOTION_OUTPUT_PUBLIC === 'true';
const MAX_JOBS = Number(process.env.REMOTION_MAX_JOBS ?? 1000);
const JOB_TTL_SECONDS = Number(process.env.REMOTION_JOB_TTL_SECONDS ?? 6 * 60 * 60);
const OUTPUT_TTL_SECONDS = Number(process.env.REMOTION_OUTPUT_TTL_SECONDS ?? 24 * 60 * 60);
const RENDER_TIMEOUT_SECONDS = Number(process.env.REMOTION_RENDER_TIMEOUT_SECONDS ?? 900);
const CALLBACK_TIMEOUT_MS = Number(process.env.REMOTION_CALLBACK_TIMEOUT_MS ?? 5000);
const CALLBACK_ALLOWLIST = (process.env.REMOTION_CALLBACK_ALLOWLIST ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

const manager = new RenderManager({
  concurrency: CONCURRENCY,
  outputDir: OUTPUT_DIR,
  publicBaseUrl: PUBLIC_BASE_URL,
  webhookSecret: WEBHOOK_SECRET,
  maxJobs: MAX_JOBS,
  jobTtlSeconds: JOB_TTL_SECONDS,
  outputTtlSeconds: OUTPUT_TTL_SECONDS,
  renderTimeoutMs: Math.max(10_000, RENDER_TIMEOUT_SECONDS * 1000),
  callbackAllowlist: CALLBACK_ALLOWLIST,
  callbackTimeoutMs: Math.max(1000, CALLBACK_TIMEOUT_MS),
});

const isAuthValid = (req: Request) => {
  if (!API_SECRET) return true;
  const headerAuth = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];
  return headerAuth === `Bearer ${API_SECRET}` || apiKey === API_SECRET;
};

// Simple auth layer: require shared secret when configured
app.use((req, res, next) => {
  if (!API_SECRET) {
    return next();
  }
  if (req.path === '/health') {
    return next();
  }
  if (OUTPUT_PUBLIC && req.path.startsWith('/output')) {
    return next();
  }
  if (isAuthValid(req)) {
    return next();
  }
  res.status(401).json({ error: 'unauthorized' });
});

app.use('/output', express.static(OUTPUT_DIR));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ...manager.getHealth() });
});

const isAllowedCallbackUrl = (url: string): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (!['http:', 'https:'].includes(protocol)) return false;
    if (protocol === 'http:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return false;
    }

    if (CALLBACK_ALLOWLIST.length === 0) {
      return hostname === 'localhost' || hostname === '127.0.0.1';
    }

    return CALLBACK_ALLOWLIST.some((allowed) => {
      const dom = allowed.toLowerCase().replace(/^\.+|\.+$/g, '');
      if (!dom) return false;
      return hostname === dom || hostname.endsWith(`.${dom}`);
    });
  } catch {
    return false;
  }
};

app.post('/api/render', async (req: Request, res: Response) => {
  const body: Partial<RenderRequest> = req.body ?? {};

  // Must have either template or composition_code
  const hasTemplate = body.template && typeof body.template === 'string';
  const hasCode = body.composition_code && typeof body.composition_code === 'string';

  if (!hasTemplate && !hasCode) {
    res.status(400).json({ error: 'Either template or composition_code is required' });
    return;
  }

  // Require sandbox for custom code to reduce supply-chain risk
  if (hasCode && (!SANDBOX_ENABLED || !SANDBOX_STRICT)) {
    res.status(400).json({ error: 'composition_code is disabled without strict sandboxing; use template mode' });
    return;
  }

  if (hasCode && !ALLOW_COMPOSITION_CODE) {
    res.status(400).json({ error: 'composition_code not allowed by configuration' });
    return;
  }

  if (!Array.isArray(body.clips) || body.clips.length === 0) {
    res.status(400).json({ error: 'clips must be a non-empty array' });
    return;
  }

  // Support objects/texts at top level OR inside input_props (for tool compatibility)
  const inputProps = (body as any).input_props ?? {};
  const objects = body.objects ?? inputProps.objects;
  const texts = body.texts ?? inputProps.texts;

  // Support both duration_frames and duration_seconds
  const fps = body.fps ?? 30;
  if (hasTemplate && fps !== 30) {
    res.status(400).json({ error: 'template renders require fps=30 to match fixed timelines' });
    return;
  }
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
    texts: texts,
    duration_frames: durationFrames,
    fps: fps,
    width: body.width ?? 1080,
    height: body.height ?? 1920,
    callback_url: body.callback_url,
  };

  if (request.callback_url && !isAllowedCallbackUrl(request.callback_url)) {
    res.status(400).json({ error: 'callback_url is not allowlisted' });
    return;
  }

  try {
    const job = await manager.enqueue(request);
    res.status(202).json({
      job_id: job.id,
      status: job.status,
      template: job.template,
    });
  } catch (error) {
    console.error('Failed to enqueue render', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('queue is full')) {
      res.status(429).json({ error: 'render_queue_full' });
      return;
    }
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
