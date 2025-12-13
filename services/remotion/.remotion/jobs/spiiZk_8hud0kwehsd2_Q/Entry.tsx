import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["https://tempfile.aiquickdraw.com/v/0d4f036576ca61cfda01487a2c479be2_1764985518.mp4","https://tempfile.aiquickdraw.com/v/75b1038d89edc335cd3d5760dbc1ae6c_1764985544.mp4"];
const durationInFrames = 600;
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
      defaultProps={{ clips }}
    />
  </>
);

registerRoot(RemotionRoot);
