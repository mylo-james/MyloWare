import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

import React from 'react';
import { AbsoluteFill, Sequence, Video, useCurrentFrame, interpolate } from 'remotion';

const QuoteOverlay: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30, 270, 300], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  const translateY = interpolate(frame, [0, 30], [30, 0], { extrapolateRight: 'clamp' });
  
  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
    }}>
      <div style={{
        fontSize: 64,
        fontWeight: 'bold',
        color: 'white',
        textAlign: 'center',
        textShadow: '3px 3px 10px rgba(0,0,0,0.8)',
        opacity,
        transform: `translateY(${translateY}px)`,
        maxWidth: '90%',
        lineHeight: 1.3,
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const RemotionComposition: React.FC<{ clips: string[] }> = ({ clips }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Clip 1: frames 0-300 (10 seconds) */}
      <Sequence from={0} durationInFrames={300}>
        <Video src={clips[0]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <QuoteOverlay text="Strength does not come from winning." />
      </Sequence>
      
      {/* Clip 2: frames 300-600 (10 seconds) */}
      <Sequence from={300} durationInFrames={300}>
        <Video src={clips[1]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <QuoteOverlay text="The ocean stirs the heart, inspires the imagination." />
      </Sequence>
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
