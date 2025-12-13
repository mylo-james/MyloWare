import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["http://localhost:8000/v1/media/transcoded/puppies_aries.mp4","http://localhost:8000/v1/media/transcoded/puppies_taurus.mp4","http://localhost:8000/v1/media/transcoded/puppies_gemini.mp4","http://localhost:8000/v1/media/transcoded/puppies_cancer.mp4","http://localhost:8000/v1/media/transcoded/puppies_leo.mp4","http://localhost:8000/v1/media/transcoded/puppies_virgo.mp4","http://localhost:8000/v1/media/transcoded/puppies_libra.mp4","http://localhost:8000/v1/media/transcoded/puppies_scorpio.mp4","http://localhost:8000/v1/media/transcoded/puppies_sagittarius.mp4","http://localhost:8000/v1/media/transcoded/puppies_capricorn.mp4","http://localhost:8000/v1/media/transcoded/puppies_aquarius.mp4","http://localhost:8000/v1/media/transcoded/puppies_pisces.mp4"];
const objects = [];
const durationInFrames = 2220;
const fps = 30;
const width = 1080;
const height = 1920;

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
