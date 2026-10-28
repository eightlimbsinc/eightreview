import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Browser } from "../ui/Browser";
import { Caption } from "../ui/Caption";
import { Cursor } from "../ui/Cursor";
import { MockSite } from "../ui/MockSite";
import { Chip, Highlight, Pin, Toast, Toolbar } from "../ui/Overlay";
import { C, ease, fontFamily } from "../theme";

const MESSAGE = "Please change this to “1,000+ Employees”";

export const Comment: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = MESSAGE.slice(0, Math.max(0, Math.round(interpolate(frame, [118, 188], [0, MESSAGE.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))));
  const posted = frame >= 208;
  const boxIn = interpolate(frame, [102, 118], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Caption step="Step 3" title="Click to comment" text="Press C (or Comment), click any text, and type your note. Your box opens right beside it." />
      <Browser url="eightreview.netlify.app/r/about" enter={false}>
        <MockSite />
        <Highlight x={16} y={258} w={1048} h={274} tag="● Needs your review · Updated copy" />
        <Chip x={1064} y={212} label="Our Clients Come First" />
        {frame >= 40 && frame < 102 ? (
          <div style={{ position: "absolute", left: 812, top: 460, width: 160, height: 28, outline: `2px solid ${C.blue}`, borderRadius: 3, background: "rgba(13,153,255,.08)", opacity: interpolate(frame, [80, 88], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />
        ) : null}
        {boxIn > 0 ? (
          <>
            <svg style={{ position: "absolute", inset: 0, width: 1080, height: 734, overflow: "visible", opacity: boxIn }}>
              <line x1={826} y1={470} x2={782} y2={470} stroke={C.blue} strokeWidth={2} strokeDasharray="5 4" />
              <circle cx={826} cy={470} r={5} fill={C.blue} stroke="#fff" strokeWidth={2} />
            </svg>
            <div
              style={{
                position: "absolute",
                left: 412,
                top: 380,
                width: 370,
                background: "#fff",
                borderRadius: 14,
                boxShadow: "0 16px 50px rgba(0,0,0,.28)",
                padding: 16,
                fontFamily,
                opacity: boxIn,
                translate: interpolate(frame, [102, 122], ["16px 0px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
              }}
            >
              <div style={{ fontSize: 14, color: "#777", marginBottom: 10 }}>{posted ? "#1 · Our Clients Come First" : "New comment · Our Clients Come First"}</div>
              {posted ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 14, background: "#3b5bdb", color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>SC</span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>Sarah · <span style={{ fontWeight: 400, color: "#888" }}>just now</span></div>
                    <div style={{ fontSize: 17, marginTop: 2 }}>{MESSAGE}</div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "#666", background: "#f4f4f4", borderRadius: 7, padding: "7px 10px", marginBottom: 10 }}>On: “Lorem Ipsum”</div>
                  <div style={{ border: `2px solid ${C.blue}`, borderRadius: 9, padding: "10px 12px", minHeight: 64, fontSize: 18, color: "#1e1e1e" }}>
                    {typed}
                    <span style={{ opacity: frame % 20 < 10 ? 1 : 0, color: C.blue }}>|</span>
                  </div>
                  <div style={{ display: "flex", marginTop: 12 }}>
                    <span style={{ background: "#f1ebff", color: C.violet, fontWeight: 700, fontSize: 14, padding: "8px 12px", borderRadius: 8 }}>✨ SEO-optimize</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ background: C.blue, color: "#fff", fontWeight: 700, fontSize: 15, padding: "8px 16px", borderRadius: 8, scale: frame >= 200 && frame < 207 ? 0.94 : 1 }}>Post</span>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}
        {posted ? <Pin x={826} y={470} n={1} /> : null}
        <Toolbar comment={frame >= 34 && frame < 208} />
        {frame >= 210 && frame < 262 ? <Toast text="Comment posted" /> : null}
        <Cursor
          path={[
            { f: 0, x: 700, y: 560 },
            { f: 28, x: 452, y: 690 },
            { f: 40, x: 452, y: 690 },
            { f: 92, x: 860, y: 476 },
            { f: 170, x: 860, y: 476 },
            { f: 198, x: 742, y: 552 },
            { f: 240, x: 742, y: 552 },
          ]}
          clicks={[32, 100, 200]}
        />
      </Browser>
    </AbsoluteFill>
  );
};
