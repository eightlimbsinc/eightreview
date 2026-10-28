import { AbsoluteFill, interpolate, useCurrentFrame, Interactive } from "remotion";
import { C, ease, fontFamily } from "../theme";

// Left-hand step caption: "Step 2", a big title and one supporting line.
export const Caption: React.FC<{ step: string; title: string; text: string }> = ({ step, title, text }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ fontFamily, pointerEvents: "none" }}>
      <Interactive.Div
        name="Step"
        style={{
          position: "absolute",
          left: 100,
          top: 300,
          color: C.gold,
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          opacity: interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
          translate: interpolate(frame, [0, 20], ["0px 24px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
        }}
      >
        {step}
      </Interactive.Div>
      <Interactive.Div
        name="Title"
        style={{
          position: "absolute",
          left: 100,
          top: 352,
          width: 600,
          color: C.white,
          fontSize: 76,
          lineHeight: 1.05,
          fontWeight: 800,
          letterSpacing: -1.5,
          opacity: interpolate(frame, [5, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
          translate: interpolate(frame, [5, 28], ["0px 30px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
        }}
      >
        {title}
      </Interactive.Div>
      <Interactive.Div
        name="Text"
        style={{
          position: "absolute",
          left: 100,
          top: 640,
          width: 580,
          color: "#c9c9c9",
          fontSize: 40,
          lineHeight: 1.3,
          fontWeight: 500,
          opacity: interpolate(frame, [14, 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
        }}
      >
        {text}
      </Interactive.Div>
    </AbsoluteFill>
  );
};
