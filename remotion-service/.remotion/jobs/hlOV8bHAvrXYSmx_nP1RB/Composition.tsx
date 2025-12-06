import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

export const MyVideo = ({ clips }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#1a1a2e" }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <AnimatedText text="HELLO REMOTION" animation="fade-up" style={{ fontSize: 72, color: "white" }} />
      </AbsoluteFill>
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
