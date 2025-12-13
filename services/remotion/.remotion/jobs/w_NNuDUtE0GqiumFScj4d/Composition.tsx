import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

import React from 'react';
import { AbsoluteFill, Sequence, Video, useCurrentFrame, interpolate } from 'remotion';

const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

// Updated OBJECTS based on creative direction
const OBJECTS = [
  'Fiery Lava Puppy', 'Velvet Earth Puppy', 'Shifting Smoke Puppets', 'Water Droplet Puppy',
  'Golden Light Puppy', 'Crystal Puppy', 'Symmetrical Cloud Puppy', 'Shadowy Mist Puppy',
  'Cosmic Stardust Puppy', 'Ancient Stone Puppy', 'Electric Neon Puppy', 'Dreamlike Watercolor Puppy'
];

const CLIP_FRAMES = 300; // 10 seconds
const OVERLAP_FRAMES = 60; // 2 seconds
const OFFSET_FRAMES = 240; // 8 seconds between starts

const ZodiacClip: React.FC<{ 
  src: string; 
  index: number;
  sign: string;
  object: string;
}> = ({ src, index, sign, object }) => {
  const frame = useCurrentFrame();
  const startFrame = index * OFFSET_FRAMES;
  const localFrame = frame - startFrame;
  
  // Fade in for first 60 frames, fade out for last 60 frames
  const opacity = interpolate(
    localFrame,
    [0, OVERLAP_FRAMES, CLIP_FRAMES - OVERLAP_FRAMES, CLIP_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  
  // Text visible during middle section (after fade in, before fade out)
  const textOpacity = interpolate(
    localFrame,
    [OVERLAP_FRAMES, OVERLAP_FRAMES + 30, CLIP_FRAMES - OVERLAP_FRAMES - 30, CLIP_FRAMES - OVERLAP_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  
  return (
    <AbsoluteFill style={{ opacity }}>
      <Video 
        src={src} 
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={(e) => console.warn('Video error:', src, e)}
        muted
      />
      <AbsoluteFill style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 120,
        opacity: textOpacity,
      }}>
        <div style={{
          fontSize: 48,
          fontWeight: 700,
          color: 'white',
          textAlign: 'center',
          textShadow: '3px 3px 15px rgba(0,0,0,0.9), 0 0 30px rgba(0,0,0,0.5)',
        }}>
          {sign} - {object}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const RemotionComposition: React.FC<{ clips: string[] }> = ({ clips }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {clips.map((src, index) => (
        <Sequence key={index} from={index * OFFSET_FRAMES} durationInFrames={CLIP_FRAMES}>
          <ZodiacClip
            src={src}
            index={index}
            sign={ZODIAC_SIGNS[index]}
            object={OBJECTS[index]}
          />
        </Sequence>
      ))}
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
