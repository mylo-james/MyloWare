import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["http://localhost:8000/v1/media/transcoded/puppies_aries.mp4"];
const objects = ["Test"];
const durationInFrames = 30;
const fps = 30;
const width = 100;
const height = 100;

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
