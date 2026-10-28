import { AbsoluteFill, Img, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, ease, fontFamily } from "../theme";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.ink, fontFamily, alignItems: "center", justifyContent: "center" }}>
      <Img
        name="Monogram"
        src={staticFile("monogram.png")}
        style={{
          position: "absolute",
          top: 190,
          width: 230,
          borderRadius: 28,
          opacity: interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
          scale: interpolate(frame, [0, 30], [0.7, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease, output: "perceptual-scale" }),
        }}
      />
      <Interactive.Div
        name="Headline"
        style={{
          position: "absolute",
          top: 520,
          width: 1760,
          textAlign: "center",
          color: C.white,
          fontSize: 92,
          fontWeight: 800,
          letterSpacing: -2,
          lineHeight: 1.05,
          opacity: interpolate(frame, [18, 38], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
          translate: interpolate(frame, [18, 44], ["0px 40px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
        }}
      >
        Reviewing your website just got easy
      </Interactive.Div>
      <Interactive.Div
        name="Subline"
        style={{
          position: "absolute",
          top: 760,
          color: C.gold,
          fontSize: 44,
          fontWeight: 600,
          opacity: interpolate(frame, [36, 56], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
        }}
      >
        A 1-minute guide to EightReview by Eight Limbs
      </Interactive.Div>
    </AbsoluteFill>
  );
};
