import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

export const RemotionComposition: React.FC<{ clips: string[] }> = ({ clips }) => {
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={150}>
        <VideoClip src={clips[0]} playbackRate={0.8} />
        <AnimatedText text="The challenge of climbing is what defines you." animation="fade-up" />
      </Sequence>
      <Sequence from={150} durationInFrames={150}>
        <Transition type="crossfade" durationFrames={30}>
          <VideoClip src={clips[1]} playbackRate={0.8} />
          <AnimatedText text="In the waves of change, we find our true direction." animation="fade-up" />
        </Transition>
      </Sequence>
      <ColorGrade preset="cinematic" />
      <Vignette strength={0.4} />
    </AbsoluteFill>
  );
};

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
