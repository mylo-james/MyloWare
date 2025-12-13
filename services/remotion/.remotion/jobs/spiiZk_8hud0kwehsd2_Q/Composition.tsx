import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

export const MyVideo = ({ clips }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const titleOpacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });
  const titleScale = spring({ frame, fps, config: { damping: 200 } });
  
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Sequence from={0} durationInFrames={300}>
        <VideoClip src={clips[0]} playbackRate={0.8} />
        <ColorGrade preset="cinematic" />
      </Sequence>
      <Sequence from={270} durationInFrames={60}>
        <Transition type="crossfade" duration={60} />
      </Sequence>
      <Sequence from={300} durationInFrames={300}>
        <VideoClip src={clips[1]} />
        <ColorGrade preset="moody" />
      </Sequence>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150 }}>
        <div style={{ opacity: titleOpacity, transform: `scale(${titleScale})`, fontSize: 80, fontWeight: "bold", color: "white", textShadow: "0 4px 30px rgba(0,0,0,0.8)" }}>URBAN PULSE</div>
      </AbsoluteFill>
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
