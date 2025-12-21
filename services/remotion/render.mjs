import path from 'node:path';
import crypto from 'node:crypto';
import { mkdir, writeFile, copyFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, openBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FRAME_CONCURRENCY = process.env.REMOTION_FRAME_CONCURRENCY ?? '100%';
const BUNDLE_CACHE_MAX = Number(process.env.REMOTION_BUNDLE_CACHE_MAX ?? 32);
const BUNDLE_CACHE_TTL_MS = Number(process.env.REMOTION_BUNDLE_CACHE_TTL_SECONDS ?? 3600) * 1000;
const BROWSER_IDLE_TTL_MS = Number(process.env.REMOTION_BROWSER_IDLE_TTL_SECONDS ?? 300) * 1000;

const bundleCache = new Map();
const bundleInFlight = new Map();

let browserPromise;
let browserLastUsed = 0;
let browserIdleTimer;

const getBrowser = async () => {
  if (!browserPromise) {
    browserPromise = openBrowser({
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
      },
    });
  }
  try {
    const browser = await browserPromise;
    browserLastUsed = Date.now();
    scheduleBrowserIdleClose();
    return browser;
  } catch (err) {
    browserPromise = undefined;
    throw err;
  }
};

const scheduleBrowserIdleClose = () => {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
  }
  if (BROWSER_IDLE_TTL_MS <= 0) return;
  browserIdleTimer = setTimeout(async () => {
    if (!browserPromise) return;
    const idleFor = Date.now() - browserLastUsed;
    if (idleFor < BROWSER_IDLE_TTL_MS) {
      scheduleBrowserIdleClose();
      return;
    }
    try {
      const browser = await browserPromise;
      await browser.close();
    } catch {
      // ignore
    } finally {
      browserPromise = undefined;
    }
  }, BROWSER_IDLE_TTL_MS);
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

const bundleKey = ({
  compositionHash,
  width,
  height,
  fps,
  durationFrames,
}) => {
  const base = `comp:${compositionHash}`;
  return `${base}-w${width}-h${height}-fps${fps}-dur${durationFrames}`;
};

const ensureComponentsCopied = async (bundleDir) => {
  const componentsDir = path.join(bundleDir, 'components');
  if (existsSync(componentsDir)) return;
  await mkdir(componentsDir, { recursive: true });

  const srcComponentsDir = path.join(__dirname, 'src', 'components');
  const componentFiles = await readdir(srcComponentsDir);
  for (const file of componentFiles) {
    const srcPath = path.join(srcComponentsDir, file);
    const destPath = path.join(componentsDir, file);
    await copyFile(srcPath, destPath);
  }

  const indexContent = `export * from './VideoClip';
export * from './AnimatedText';
export * from './Transition';
export * from './Effects';
`;
  await writeFile(path.join(componentsDir, 'index.ts'), indexContent, 'utf8');
};

const buildCompositionSource = async ({ template, compositionCode }) => {
  let finalCompositionCode;

  if (template) {
    const templatePath = path.join(__dirname, 'templates', `${template}.tsx`);
    if (!existsSync(templatePath)) {
      throw new Error(`Template not found: ${template}`);
    }
    finalCompositionCode = await readFile(templatePath, 'utf8');
    finalCompositionCode = finalCompositionCode
      .split('\n')
      .filter(line => !line.trim().startsWith('import ') && !line.trim().startsWith('/**') && !line.trim().startsWith('*'))
      .join('\n');
  } else if (compositionCode) {
    finalCompositionCode = compositionCode
      .split('\n')
      .filter(line => !line.trim().startsWith('import '))
      .join('\n');
  } else {
    throw new Error('Either template or compositionCode must be provided');
  }

  const prelude = `import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring, Video } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';
`;

  const postlude = `
// Detect exported composition component
const CompositionComponent =
  typeof MyVideo !== 'undefined' ? MyVideo :
  typeof RemotionComposition !== 'undefined' ? RemotionComposition :
  typeof Composition !== 'undefined' ? Composition :
  undefined;

if (!CompositionComponent) {
  throw new Error('No composition component exported. Export MyVideo, RemotionComposition, or Composition.');
}

export const DynamicComposition = CompositionComponent;
`;

  return `${prelude}\n${finalCompositionCode}\n${postlude}`;
};

const getCachedBundle = (key) => {
  const entry = bundleCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (BUNDLE_CACHE_TTL_MS > 0 && now - entry.createdAt > BUNDLE_CACHE_TTL_MS) {
    bundleCache.delete(key);
    return null;
  }
  entry.lastUsed = now;
  return entry.bundle;
};

const pruneBundleCache = () => {
  if (BUNDLE_CACHE_TTL_MS > 0) {
    const now = Date.now();
    for (const [key, entry] of bundleCache.entries()) {
      if (now - entry.createdAt > BUNDLE_CACHE_TTL_MS) {
        bundleCache.delete(key);
      }
    }
  }
  if (BUNDLE_CACHE_MAX <= 0) {
    bundleCache.clear();
    return;
  }
  if (bundleCache.size <= BUNDLE_CACHE_MAX) return;
  const entries = Array.from(bundleCache.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  while (entries.length && bundleCache.size > BUNDLE_CACHE_MAX) {
    const [key] = entries.shift();
    bundleCache.delete(key);
  }
};

const ensureBundle = async ({ key, bundleDir, entryContents, compositionContents }) => {
  pruneBundleCache();
  const cached = getCachedBundle(key);
  if (cached) return cached;
  if (bundleInFlight.has(key)) {
    return bundleInFlight.get(key);
  }
  const inFlight = (async () => {
    try {
      await mkdir(bundleDir, { recursive: true });
      await ensureComponentsCopied(bundleDir);
      const compositionFile = path.join(bundleDir, 'Composition.tsx');
      const entryFile = path.join(bundleDir, 'Entry.tsx');

      await writeFile(compositionFile, compositionContents, 'utf8');
      await writeFile(entryFile, entryContents, 'utf8');

      const bundled = await bundle({
        entryPoint: entryFile,
        webpackOverride: (config) => config,
      });
      if (BUNDLE_CACHE_MAX > 0) {
        bundleCache.set(key, { bundle: bundled, createdAt: Date.now(), lastUsed: Date.now() });
      }
      return bundled;
    } finally {
      bundleInFlight.delete(key);
    }
  })();
  bundleInFlight.set(key, inFlight);
  return inFlight;
};

/**
 * Render a video using either a template or custom composition code.
 *
 * @param {Object} options
 * @param {string} options.jobId - Unique job identifier
 * @param {string} [options.template] - Template name (e.g., "aismr", "motivational") - if provided, uses pre-built template
 * @param {string} [options.compositionCode] - Custom TSX code (used if no template)
 * @param {string[]} options.clips - Array of video URLs
 * @param {string[]} [options.objects] - Array of object names (for AISMR template)
 * @param {string[]} [options.texts] - Array of text overlays (for motivational template)
 * @param {number} options.durationFrames - Total duration in frames
 * @param {number} options.fps - Frames per second
 * @param {number} options.width - Output width
 * @param {number} options.height - Output height
 * @param {string} options.outputPath - Where to save the rendered video
 * @param {number} [options.timeoutMs] - Cancel render after this many milliseconds
 * @param {Function} [options.onProgress] - Progress callback
 */
export async function renderVideo({
  jobId,
  template,
  compositionCode,
  clips,
  objects,
  texts,
  durationFrames,
  fps,
  width,
  height,
  outputPath,
  timeoutMs,
  onProgress,
}) {
  const jobDir = path.join(process.cwd(), '.remotion', 'jobs', jobId);
  await mkdir(jobDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  // Build props for the composition
  const inputProps = { clips };
  if (objects && objects.length > 0) {
    inputProps.objects = objects;
  }
  if (texts && texts.length > 0) {
    inputProps.texts = texts;
  }

  const compositionContents = await buildCompositionSource({ template, compositionCode });
  const compositionHash = sha256(compositionContents);
  const key = bundleKey({ compositionHash, width, height, fps, durationFrames });
  const bundleDir = path.join(process.cwd(), '.remotion', 'bundles', key);
  const entryContents = `import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const durationInFrames = ${durationFrames};
const fps = ${fps};
const width = ${width};
const height = ${height};

const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="DynamicComposition"
      component={DynamicComposition}
      durationInFrames={durationInFrames}
      fps={fps}
      width={width}
      height={height}
      defaultProps={{ clips: [], objects: [], texts: [] }}
    />
  </>
);

registerRoot(RemotionRoot);
`;

  console.log(`Bundling composition for job ${jobId}...`);
  const bundled = await ensureBundle({
    key,
    bundleDir,
    entryContents,
    compositionContents,
  });

  console.log(`Selecting composition...`);
  const composition = await selectComposition({
    serveUrl: bundled,
    id: 'DynamicComposition',
    inputProps,
  });

  const browser = await getBrowser();

  console.log(`Rendering ${durationFrames} frames at ${fps}fps (${width}x${height})...`);
  const { cancelSignal, cancel } = makeCancelSignal();
  const timeout = timeoutMs ? setTimeout(() => cancel(), timeoutMs) : null;
  try {
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      concurrency: FRAME_CONCURRENCY,
      puppeteerInstance: browser,
      cancelSignal,
      timeoutInMilliseconds: timeoutMs || undefined,
      onProgress: ({ progress }) => {
        if (onProgress) {
          onProgress(progress);
        }
      },
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  console.log(`Render complete: ${outputPath}`);
  return outputPath;
}
