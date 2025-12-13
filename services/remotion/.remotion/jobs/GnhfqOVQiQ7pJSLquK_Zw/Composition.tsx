import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

import React from 'react';
import { AbsoluteFill, Sequence, Video, useCurrentFrame, interpolate } from 'remotion';

const TextOverlay: React.FC<{ text: string; bold?: boolean }> = ({ text, bold = false }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, 135, 150], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scale = interpolate(frame, [0, 15], [0.9, 1], { extrapolateRight: 'clamp' });
  
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 50 }}>
      <div style={{
        fontSize: bold ? 72 : 56,
        fontWeight: bold ? 900 : 700,
        color: 'white',
        textAlign: 'center',
        textShadow: '4px 4px 20px rgba(0,0,0,0.9), 0 0 60px rgba(0,0,0,0.5)',
        textTransform: bold ? 'uppercase' : 'none',
        letterSpacing: bold ? '0.05em' : '-0.01em',
        opacity,
        transform: `scale(${scale})`,
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
      {/* Video 1: 0-10s */}
      <Sequence from={0} durationInFrames={300}>
        <Video src={clips[0]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Sequence>
      
      {/* Video 2: 10-20s */}
      <Sequence from={300} durationInFrames={300}>
        <Video src={clips[1]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Sequence>
      
      {/* Text overlays */}
      <Sequence from={0} durationInFrames={150}>
        <TextOverlay text='EMBRACE THE JOURNEY' bold={true} />
      </Sequence>
      <Sequence from={150} durationInFrames={150}>
        <TextOverlay text='Step away from fear' />
      </Sequence>
      <Sequence from={300} durationInFrames={150}>
        <TextOverlay text='DISCOVER YOUR STRENGTH' bold={true} />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <TextOverlay text='KEEP MOVING FORWARD' />
      </Sequence>
      
      {/* Vignette */}
      <AbsoluteFill style={{
        background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.5) 100%)',
        pointerEvents: 'none',
      }} />
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
