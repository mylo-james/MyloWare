import React from 'react';
import { Composition } from 'remotion';
import { AbsoluteFill } from 'remotion';

const Placeholder: React.FC = () => (
  <AbsoluteFill
    style={{
      justifyContent: 'center',
      alignItems: 'center',
      fontSize: 64,
      color: 'white',
      background: 'linear-gradient(135deg, #0f172a, #1e293b)',
    }}
  >
    Remotion Service
  </AbsoluteFill>
);

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="Placeholder"
        component={Placeholder}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
    </>
  );
};
