import React from 'react';
import {registerRoot, Composition, AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
const Title = () => {
  const f = useCurrentFrame(); const {fps} = useVideoConfig();
  const s = spring({frame: f, fps, config: {damping: 12}});
  const o = interpolate(f, [0, 20], [0, 1]);
  return (<AbsoluteFill style={{background: 'linear-gradient(135deg,#0f172a,#7c3aed)', justifyContent: 'center', alignItems: 'center'}}>
    <h1 style={{color: 'white', fontSize: 120, fontFamily: 'DejaVu Sans', opacity: o, transform: `scale(${0.6 + 0.4 * s})`}}>OTHO 8.8</h1>
  </AbsoluteFill>);
};
registerRoot(() => <Composition id="T" component={Title} durationInFrames={60} fps={30} width={960} height={540} />);
