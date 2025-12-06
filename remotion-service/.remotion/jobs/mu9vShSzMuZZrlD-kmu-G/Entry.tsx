import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["https://tempfile.aiquickdraw.com/v/1a42c981262c723f9eb24f29f7b435e5_1764995543.mp4","https://tempfile.aiquickdraw.com/v/ae0f8c5b8a5df18f2dee8e60f5ee40bd_1764995539.mp4","https://tempfile.aiquickdraw.com/v/d2c13c90464f2daec8d249fefc6716e8_1764995529.mp4","https://tempfile.aiquickdraw.com/v/4d0297f4344bc0c1b5cc3d834c7e6ef8_1764995528.mp4","https://tempfile.aiquickdraw.com/v/59f2bea35b8b300179a7e62980bca0fd_1764995528.mp4","https://tempfile.aiquickdraw.com/v/604774ca46ddc90eb11a7681f77aa936_1764995525.mp4","https://tempfile.aiquickdraw.com/v/7e38b6933cba1db14870fd0a61c3be0b_1764995523.mp4","https://tempfile.aiquickdraw.com/v/9f9ab798dd08fea9797ab2c93ba33f0d_1764995524.mp4","https://tempfile.aiquickdraw.com/v/55678139ba6a98b0fa52f1738d15628b_1764995523.mp4","https://tempfile.aiquickdraw.com/v/133c520921e32ccba64b10f0e8e3363e_1764995518.mp4","https://tempfile.aiquickdraw.com/v/3f2f5e53289efdd96a07eb995cd3085d_1764995518.mp4","https://tempfile.aiquickdraw.com/v/dd9147c173c91e18e9c2463e1acc81ce_1764995514.mp4"];
const durationInFrames = 900;
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
