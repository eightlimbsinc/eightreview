import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Browser } from "../ui/Browser";
import { Caption } from "../ui/Caption";
import { Cursor } from "../ui/Cursor";
import { MockSite } from "../ui/MockSite";
import { Chip, Highlight, Toast, Toolbar } from "../ui/Overlay";
import { C, ease, fontFamily } from "../theme";

const Mark: React.FC<{ kind: "seo" | "aeo"; glow: number; children: React.ReactNode }> = ({ kind, glow, children }) => (
  <span
    style={{
      background: kind === "seo" ? "#d6ebff" : "#efe5ff",
      color: kind === "seo" ? "#0a4d8c" : "#5b21b6",
      boxShadow: `inset 0 -3px 0 ${kind === "seo" ? C.blue : "#8b5cf6"}, 0 0 0 ${glow}px ${kind === "seo" ? "rgba(13,153,255,.25)" : "rgba(139,92,246,.25)"}`,
      borderRadius: 5,
      padding: "0 3px",
    }}
  >
    {children}
  </span>
);

export const Suggest: React.FC = () => {
  const frame = useCurrentFrame();
  const open = interpolate(frame, [44, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const glow = interpolate(frame, [120, 140, 160, 180], [0, 6, 0, 6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const used = frame >= 222;
  const item = (i: number) => ({
    opacity: interpolate(frame, [72 + i * 12, 90 + i * 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
    translate: interpolate(frame, [72 + i * 12, 94 + i * 12], ["0px 14px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
  });
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Caption step="Step 5" title="Try our suggested copy" text="SEO-ready copy, written for you. Keep the coloured words, they help people find you." />
      <Browser url="eightreview.netlify.app/r/about" enter={false}>
        <MockSite />
        <Highlight x={16} y={258} w={1048} h={274} state={used ? "approved" : "waiting"} tag={used ? "✓ Approved" : "● Needs your review"} />
        <div style={{ opacity: 1 - open }}>
          <Chip x={1064} y={212} label="Our Clients Come First" suggest />
        </div>
        <Toolbar progress={used ? "1/1 reviewed" : "0/1 to review"} done={used} />
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: 430,
            background: "#fff",
            borderLeft: `5px solid ${C.yellow}`,
            boxShadow: "-12px 0 34px rgba(0,0,0,.2)",
            padding: "18px 20px",
            fontFamily,
            color: "#1e1e1e",
            translate: interpolate(frame, [44, 70], ["440px 0px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ background: C.yellow, fontWeight: 800, borderRadius: 999, padding: "5px 13px", fontSize: 16 }}>💡 Suggested copy</span>
            <span style={{ color: "#666", fontSize: 15, fontWeight: 600 }}>Our Clients Come First</span>
          </div>
          <ol style={{ margin: "14px 0 10px", paddingLeft: 22, fontSize: 15, lineHeight: 1.5, color: "#333" }}>
            <li>Read the new copy below.</li>
            <li><Mark kind="seo" glow={0}>Coloured words</Mark> help Google and AI search, so please <b>keep them</b>.</li>
            <li>Click <b>✓ Use this copy</b>, or <b>✎ Change it</b>.</li>
          </ol>
          {used ? <div style={{ background: "#e3f6ec", color: "#0b7a40", fontWeight: 700, borderRadius: 9, padding: "9px 12px", marginBottom: 10, fontSize: 15 }}>✓ Approved. Thank you!</div> : null}
          <div style={{ border: "1px solid #eee", borderRadius: 11, padding: "10px 12px", background: "#fcfcfb", ...item(0) }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#999", letterSpacing: 0.5 }}>HEADING</div>
            <div style={{ fontSize: 19, marginTop: 4, fontWeight: 600 }}>
              <Mark kind="seo" glow={glow}>Enterprise AI consulting</Mark> that puts our clients first
            </div>
          </div>
          <div style={{ border: "1px solid #eee", borderRadius: 11, padding: "10px 12px", background: "#fcfcfb", marginTop: 10, ...item(1) }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#999", letterSpacing: 0.5 }}>PARAGRAPH</div>
            <div style={{ fontSize: 16, marginTop: 4, lineHeight: 1.5 }}>
              Everything we do starts with one belief: our clients are the hero of the story. It&apos;s{" "}
              <Mark kind="aeo" glow={glow}>how Blend360 works with clients</Mark>, from first{" "}
              <Mark kind="seo" glow={glow}>data strategy</Mark> to measurable results.
            </div>
          </div>
          <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 11, padding: "10px 12px", fontSize: 15, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", ...item(2) }}>
            Section score <b>92/100</b>
            <span style={{ background: "#e3f6ec", color: "#0b7a40", borderRadius: 999, padding: "1px 8px", fontSize: 13 }}><b>95</b> SEO</span>
            <span style={{ background: "#e3f6ec", color: "#0b7a40", borderRadius: 999, padding: "1px 8px", fontSize: 13 }}><b>90</b> AEO</span>
            <span style={{ background: "#e3f6ec", color: "#0b7a40", borderRadius: 999, padding: "1px 8px", fontSize: 13 }}><b>93</b> Voice</span>
          </div>
          <div style={{ position: "absolute", left: 20, right: 20, bottom: 18, display: "flex", gap: 10, ...item(3) }}>
            <span style={{ background: C.green, color: "#fff", fontWeight: 700, fontSize: 17, padding: "12px 18px", borderRadius: 10, scale: frame >= 214 && frame < 221 ? 0.94 : 1 }}>✓ Use this copy</span>
            <span style={{ background: "#f0f0ec", fontWeight: 700, fontSize: 17, padding: "12px 18px", borderRadius: 10 }}>✎ Change it</span>
          </div>
        </div>
        {open > 0.9 ? (
          <svg style={{ position: "absolute", inset: 0, width: 1080, height: 734, overflow: "visible" }}>
            <defs>
              <marker id="ah" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill={C.yellow} />
              </marker>
            </defs>
            <line x1={646} y1={330} x2={600} y2={330} stroke={C.yellow} strokeWidth={4} strokeDasharray="7 5" markerEnd="url(#ah)" />
          </svg>
        ) : null}
        {used && frame < 290 ? <Toast text="Copy approved. Thank you!" /> : null}
        <Cursor
          path={[
            { f: 0, x: 868, y: 232 },
            { f: 34, x: 744, y: 232 },
            { f: 120, x: 760, y: 420 },
            { f: 204, x: 735, y: 700 },
            { f: 260, x: 735, y: 700 },
          ]}
          clicks={[40, 216]}
        />
      </Browser>
    </AbsoluteFill>
  );
};
