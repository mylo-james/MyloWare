import React from 'react';
import { AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { OffthreadVideo } from 'remotion';
import { VideoClip, AnimatedText, Transition, ColorGrade, Vignette } from './components';

import { Composition, Video, Sequence, useCurrentFrame, interpolate } from 'remotion';
import { Vignette } from 'my-vignette-component'; // You may need to implement your own Vignette component
import { ColorGrade } from 'my-color-grade-component'; // You may need to implement your own ColorGrade component
import { Transition } from 'my-transition-component'; // You may need to implement your own Transition component

const AnimatedText = ({ text }: { text: string }) => {
    const frame = useCurrentFrame();
    const opacity = interpolate(frame, [0, 10], [0, 1]);

    return (
        <div style={{
            position: 'absolute',
            bottom: '20%',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'white',
            fontSize: '48px',
            textShadow: '2px 2px 8px rgba(0, 0, 0, 0.7)',
            opacity,
            transition: 'opacity 5s',
        }}>
            {text}
        </div>
    );
};

export const RemotionComposition = ({ clips }: { clips: string[] }) => {
    return (
        <Composition
            id="MotivationalVideo"
            component={() => (
                <>
                    <Sequence>
                        <Video src={clips[0]} volume={1} playbackRate={0.8} />
                        <AnimatedText text="Strength does not come from winning." />
                    </Sequence>
                    <Transition>
                        <ColorGrade>
                            <Sequence>
                                <Video src={clips[1]} volume={1} playbackRate={0.8} />
                                <AnimatedText text="The ocean stirs the heart, inspires the imagination." />
                            </Sequence>
                        </ColorGrade>
                    </Transition>
                    <Vignette />
                </>
            )}
            durationInFrames={600} // Adjust according to desired duration and fps
            fps={30}
            width={1080} // for 9:16 aspect ratio
            height={1920}
        />
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
