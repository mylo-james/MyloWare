import path from 'node:path';
import { mkdir, writeFile, copyFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Render a video using either a template or custom composition code.
 * 
 * @param {Object} options
 * @param {string} options.jobId - Unique job identifier
 * @param {string} [options.template] - Template name (e.g., "aismr") - if provided, uses pre-built template
 * @param {string} [options.compositionCode] - Custom TSX code (used if no template)
 * @param {string[]} options.clips - Array of video URLs
 * @param {string[]} [options.objects] - Array of object names (for AISMR template)
 * @param {number} options.durationFrames - Total duration in frames
 * @param {number} options.fps - Frames per second
 * @param {number} options.width - Output width
 * @param {number} options.height - Output height
 * @param {string} options.outputPath - Where to save the rendered video
 * @param {Function} [options.onProgress] - Progress callback
 */
export async function renderVideo({
  jobId,
  template,
  compositionCode,
  clips,
  objects,
  durationFrames,
  fps,
  width,
  height,
  outputPath,
  onProgress,
}) {
  const jobDir = path.join(process.cwd(), '.remotion', 'jobs', jobId);
  await mkdir(jobDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  // Copy component files directly into job directory
  const srcComponentsDir = path.join(__dirname, 'src', 'components');
  const jobComponentsDir = path.join(jobDir, 'components');
  await mkdir(jobComponentsDir, { recursive: true });

  // Copy all component files
  const componentFiles = await readdir(srcComponentsDir);
  for (const file of componentFiles) {
    const srcPath = path.join(srcComponentsDir, file);
    const destPath = path.join(jobComponentsDir, file);
    await copyFile(srcPath, destPath);
  }

  // Fix the index.ts to use local imports
  const indexContent = `export * from './VideoClip';
export * from './AnimatedText';
export * from './Transition';
export * from './Effects';
`;
  await writeFile(path.join(jobComponentsDir, 'index.ts'), indexContent, 'utf8');

  const compositionFile = path.join(jobDir, 'Composition.tsx');
  const entryFile = path.join(jobDir, 'Entry.tsx');

  // Determine composition code - use template if provided, otherwise use custom code
  let finalCompositionCode;
  
  if (template) {
    const templatePath = path.join(__dirname, 'templates', `${template}.tsx`);
    if (!existsSync(templatePath)) {
      throw new Error(`Template not found: ${template}`);
    }
    console.log(`Using template: ${template}`);
    finalCompositionCode = await readFile(templatePath, 'utf8');
    
    // Templates are self-contained - strip any existing imports (template has its own structure)
    finalCompositionCode = finalCompositionCode
      .split('\n')
      .filter(line => !line.trim().startsWith('import ') && !line.trim().startsWith('/**') && !line.trim().startsWith('*'))
      .join('\n');
  } else if (compositionCode) {
    // Strip any import statements from agent-provided code (we add our own)
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

  const compositionContents = `${prelude}\n${finalCompositionCode}\n${postlude}`;
  await writeFile(compositionFile, compositionContents, 'utf8');

  // Build props for the composition
  const inputProps = { clips };
  if (objects && objects.length > 0) {
    inputProps.objects = objects;
  }

  const entryContents = `import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ${JSON.stringify(clips)};
const objects = ${JSON.stringify(objects || [])};
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
      defaultProps={{ clips, objects }}
    />
  </>
);

registerRoot(RemotionRoot);
`;

  await writeFile(entryFile, entryContents, 'utf8');

  console.log(`Bundling composition for job ${jobId}...`);
  const bundled = await bundle({
    entryPoint: entryFile,
    webpackOverride: (config) => config,
  });

  console.log(`Selecting composition...`);
  const composition = await selectComposition({
    serveUrl: bundled,
    id: 'DynamicComposition',
    inputProps,
  });

  console.log(`Rendering ${durationFrames} frames at ${fps}fps (${width}x${height})...`);
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    chromiumOptions: { enableMultiProcessOnLinux: true },
    onProgress: ({ progress }) => {
      if (onProgress) {
        onProgress(progress);
      }
    },
  });

  console.log(`Render complete: ${outputPath}`);
  return outputPath;
}
