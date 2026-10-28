import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Browser } from "../ui/Browser";
import { Caption } from "../ui/Caption";
import { MockSite } from "../ui/MockSite";
import { Chip, Highlight as Box, Toolbar } from "../ui/Overlay";
import { C, ease } from "../theme";

export const Highlight: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Caption step="Step 2" title="Look for the yellow boxes" text="Yellow means we'd love your eyes on that part of the page." />
      <Browser url="eightreview.netlify.app/r/about">
        <MockSite />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
            scale: interpolate(frame, [30, 56], [1.04, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
          }}
        >
          <Box x={16} y={258} w={1048} h={274} tag="● Needs your review · Updated copy" />
        </div>
        <div style={{ position: "absolute", inset: 0, opacity: interpolate(frame, [60, 76], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }) }}>
          <Chip x={1064} y={212} label="Our Clients Come First" />
        </div>
        <div
          style={{
            position: "absolute",
            left: 16,
            top: 258,
            width: 1048,
            height: 274,
            borderRadius: 10,
            boxShadow: `0 0 0 ${interpolate(frame, [80, 110, 140], [0, 18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px rgba(255,199,0,.25)`,
          }}
        />
        <Toolbar />
      </Browser>
    </AbsoluteFill>
  );
};
