import { interpolate, useCurrentFrame } from "remotion";
import { ease } from "../theme";

type Point = { f: number; x: number; y: number };

// A mouse cursor that glides between points (canvas pixels) and shows a ripple on each click frame.
export const Cursor: React.FC<{ path: Point[]; clicks?: number[] }> = ({ path, clicks = [] }) => {
  const frame = useCurrentFrame();
  const fs = path.map((p) => p.f);
  const opts = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const, easing: ease };
  const x = path.length > 1 ? interpolate(frame, fs, path.map((p) => p.x), opts) : path[0].x;
  const y = path.length > 1 ? interpolate(frame, fs, path.map((p) => p.y), opts) : path[0].y;
  const pressed = clicks.some((c) => frame >= c && frame < c + 5);
  return (
    <>
      {clicks.map((c) =>
        frame >= c && frame < c + 18 ? (
          <div
            key={c}
            style={{
              position: "absolute",
              left: x - 30,
              top: y - 30,
              width: 60,
              height: 60,
              borderRadius: 30,
              border: "4px solid rgba(13,153,255,.8)",
              scale: interpolate(frame, [c, c + 18], [0.3, 1.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              opacity: interpolate(frame, [c, c + 18], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          />
        ) : null,
      )}
      <svg
        width="44"
        height="44"
        viewBox="0 0 24 24"
        style={{ position: "absolute", left: x - 4, top: y - 2, scale: pressed ? 0.88 : 1, filter: "drop-shadow(0 3px 6px rgba(0,0,0,.45))" }}
      >
        <path d="M3 2l7 19 2.6-7.4L20 11z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </>
  );
};
