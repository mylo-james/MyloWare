import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DynamicComposition } from './Composition';

const clips = ["https://tempfile.aiquickdraw.com/v/47521603c3164ab61066149acb623e8e_1765002727.mp4","https://tempfile.aiquickdraw.com/v/be84620816b0d542b8a1da923dd57f51_1765002746.mp4","https://tempfile.aiquickdraw.com/v/ebec4afc6b795914daad06f001058608_1765002737.mp4","https://tempfile.aiquickdraw.com/v/19ac5a87f7ce114de28dff68bd244cc1_1765002742.mp4","https://tempfile.aiquickdraw.com/v/807a8aa2cd456051ecbd32359b6a2809_1765002744.mp4","https://tempfile.aiquickdraw.com/v/67d2a9a03c88e280e8046925acb09863_1765002748.mp4","https://tempfile.aiquickdraw.com/v/33fb204306edef154edf238e622fecf3_1765002742.mp4","https://tempfile.aiquickdraw.com/v/a9c16628361ef0d2a1b575e8b3cf1afe_1765002726.mp4","https://tempfile.aiquickdraw.com/v/ea179fa79701565ce70227079406e1db_1765002732.mp4","https://tempfile.aiquickdraw.com/v/cc1576f75d9111d9a19383ce831525ff_1765002758.mp4","https://tempfile.aiquickdraw.com/v/c701a573d49f4f71bb0944a0c58e6980_1765002728.mp4","https://tempfile.aiquickdraw.com/v/5a387ce8dffa56ec2b2a044582ea25d9_1765002743.mp4"];
const objects = ["Flame Spirit","Earth Golem","Cloud Twin","Liquid Moon Cat","Radiant Sun Fox","Crystalline Owl","Symmetrical Butterfly","Shadow Serpent","Cosmic Hawk","Stone Ram","Electric Jellyfish","Dreamy Fish"];
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
