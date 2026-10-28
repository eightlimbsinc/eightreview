import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Browser } from "../ui/Browser";
import { Caption } from "../ui/Caption";
import { Cursor } from "../ui/Cursor";
import { C, ease, fontFamily } from "../theme";

const PAGES: [string, string, string, string][] = [
  ["1. Home", "/home", "Approved", C.green],
  ["2. About", "/about", "Needs your review", C.yellow],
  ["3. BlendX", "/blendx", "Layout review", "#c9c9c9"],
  ["4. Services", "/services", "Not started", "#e2e2de"],
];

export const Portal: React.FC = () => {
  const frame = useCurrentFrame();
  const press = frame >= 150 && frame < 160;
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Caption step="Step 1" title="Open your review link" text="Every page we need you to look at is listed in one place." />
      <Browser url="eightreview.netlify.app/p/blend360">
        <div style={{ position: "absolute", inset: 0, background: C.paper, fontFamily }}>
          <div style={{ height: 58, background: C.panel, display: "flex", alignItems: "center", gap: 12, padding: "0 28px", color: "#fff", fontWeight: 700, fontSize: 19 }}>
            <Img src={staticFile("mark-64.png")} style={{ width: 32, height: 32, borderRadius: 7 }} /> Website review
          </div>
          <div style={{ padding: "26px 40px 0", fontSize: 38, fontWeight: 800, color: "#1e1e1e", letterSpacing: -0.6 }}>Blend360 website</div>
          <div style={{ margin: "18px 40px 0", background: "#fff", border: "1px solid #e7e7e3", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <b style={{ fontSize: 20, color: "#1e1e1e" }}>1 of 4 pages approved</b>
              <span style={{ flex: 1 }} />
              <span style={{ background: C.blue, color: "#fff", fontWeight: 700, fontSize: 18, padding: "12px 20px", borderRadius: 10, scale: press ? 0.95 : 1 }}>Continue: About →</span>
            </div>
            <div style={{ marginTop: 16, height: 10, borderRadius: 6, background: "#ecece7", overflow: "hidden" }}>
              <div style={{ height: "100%", background: C.green, width: interpolate(frame, [20, 60], ["0%", "25%"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }) }} />
            </div>
          </div>
          {PAGES.map(([name, path, state, color], i) => (
            <div
              key={name}
              style={{
                margin: "12px 40px 0",
                background: "#fff",
                border: "1px solid #e7e7e3",
                borderRadius: 14,
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                opacity: interpolate(frame, [24 + i * 8, 40 + i * 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
                translate: interpolate(frame, [24 + i * 8, 46 + i * 8], ["0px 20px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
              }}
            >
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#1e1e1e" }}>{name}</div>
                <div style={{ fontSize: 15, color: "#888", marginTop: 2 }}>{path}</div>
              </div>
              <span style={{ flex: 1 }} />
              <span style={{ background: color, color: color === C.green ? "#fff" : "#1e1e1e", borderRadius: 999, padding: "6px 14px", fontSize: 16, fontWeight: 600 }}>{state}</span>
            </div>
          ))}
        </div>
        <Cursor path={[{ f: 60, x: 560, y: 560 }, { f: 140, x: 930, y: 190 }]} clicks={[150]} />
      </Browser>
    </AbsoluteFill>
  );
};
