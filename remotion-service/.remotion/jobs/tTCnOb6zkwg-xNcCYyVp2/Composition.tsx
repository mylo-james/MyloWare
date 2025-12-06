import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

import React from 'react';
import {
  Composition,
  Sequence,
  Video,
  useVideoConfig,
  interpolate,
  random,
} from 'remotion';

const AnimatedText = ({ text }: { text: string }) => {
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '10%',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 50,
        color: 'white',
        textShadow: '2px 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      {text.split('').map((char, index) => (
        <span
          key={index}
          style={{
            opacity: interpolate(random(0, 1), [0, 1], [0, 1]),
            transition: `opacity 0.5s ${index * 0.1}s`,
          }}
        >
          {char}
        </span>
      ))}
    </div>
  );
};

export const RemotionComposition: React.FC<{ clips: string[] }> = ({ clips }) => {
  const duration = 20; // Set the duration of the video
  const { fps } = useVideoConfig();

  return (
    <Composition
      id="MotivationalVideo"
      component={RemotionComposition}
      width={1080}
      height={1920}
      durationInFrames={duration * fps}
      fps={fps}
    >
      <Sequence durationInFrames={10 * fps}>
        <Video src={clips[0]} volume={1} />
        <AnimatedText text="What lies behind us and what lies before us are tiny matters compared to what lies within us." />
      </Sequence>
      <Sequence durationInFrames={10 * fps} startAt={10 * fps}>
        <Video src={clips[1]} volume={1} />
        <AnimatedText text="Peace is not the absence of conflict, but the presence of justice." />
      </Sequence>
    </Composition>
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
