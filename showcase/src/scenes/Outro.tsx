import { AbsoluteFill, Img, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, ease, fontFamily } from "../theme";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.ink, fontFamily, alignItems: "center" }}>
      <Interactive.Div
        name="Thats it"
        style={{
          position: "absolute",
          top: 190,
          color: C.white,
          fontSize: 110,
          fontWeight: 800,
          letterSpacing: -2,
          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
          translate: interpolate(frame, [0, 26], ["0px 30px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
        }}
      >
        That&apos;s it!
      </Interactive.Div>
      <Interactive.Div
        name="Summary"
        style={{
          position: "absolute",
          top: 350,
          width: 1400,
          textAlign: "center",
          color: "#d2d2d2",
          fontSize: 46,
          lineHeight: 1.35,
          fontWeight: 500,
          opacity: interpolate(frame, [12, 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
        }}
      >
        Look for yellow, comment, approve. We&apos;ll take it from there.
      </Interactive.Div>
      <Img
        name="Logo"
        src={staticFile("logo-full.png")}
        style={{
          position: "absolute",
          top: 520,
          width: 300,
          filter: "invert(1) hue-rotate(180deg)",
          opacity: interpolate(frame, [26, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
          scale: interpolate(frame, [26, 56], [0.85, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease, output: "perceptual-scale" }),
        }}
      />
      <Interactive.Div
        name="Signoff"
        style={{
          position: "absolute",
          top: 880,
          color: C.gold,
          fontSize: 40,
          fontWeight: 600,
          opacity: interpolate(frame, [44, 64], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
        }}
      >
        Questions? Just leave a comment. Your Eight Limbs team
      </Interactive.Div>
    </AbsoluteFill>
  );
};
