import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

import React from 'react';
import { AbsoluteFill, Sequence, Video, useCurrentFrame, interpolate } from 'remotion';

const TextOverlay: React.FC<{ text: string; fadeIn?: number; fadeOut?: number }> = ({ 
  text, 
  fadeIn = 20, 
  fadeOut = 20 
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame, 
    [0, fadeIn, 180 - fadeOut, 180], 
    [0, 1, 1, 0], 
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );  
  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      padding: 60,
    }}>
      <div style={{
        fontSize: 56,
        fontWeight: 800,
        color: 'white',
        textAlign: 'center',
        textShadow: '4px 4px 20px rgba(0,0,0,0.9), 0 0 40px rgba(0,0,0,0.5)',
        opacity,
        maxWidth: '85%',
        lineHeight: 1.4,
        letterSpacing: '-0.02em',
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const RemotionComposition: React.FC<{ clips: string[] }> = ({ clips }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Video layer */}
      <Sequence from={0} durationInFrames={300}>
        <Video src={clips[0]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Sequence>
      <Sequence from={300} durationInFrames={300}>
        <Video src={clips[1]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Sequence>
      
      {/* Text overlays */}
      <Sequence from={0} durationInFrames={180}>
        <TextOverlay text="Life finds a way." />
      </Sequence>
      <Sequence from={180} durationInFrames={180}>
        <TextOverlay text="Even in the harshest environments, nature thrives and inspires us." />
      </Sequence>
      <Sequence from={360} durationInFrames={150}>
        <TextOverlay text="Embrace challenges like nature does." />
      </Sequence>
      <Sequence from={510} durationInFrames={90}>
        <TextOverlay text="Stay hopeful." fadeOut={30} />
      </Sequence>
      
      {/* Vignette overlay */}
      <AbsoluteFill style={{
        background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.6) 100%)',
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
