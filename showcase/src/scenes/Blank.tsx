import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Browser } from "../ui/Browser";
import { Caption } from "../ui/Caption";
import { Cursor } from "../ui/Cursor";
import { MockSite } from "../ui/MockSite";
import { Pin } from "../ui/Overlay";
import { C, ease, fontFamily } from "../theme";

// Live page next to its blank wireframe. Each pane shows the page at half scale.
export const Blank: React.FC = () => {
  const frame = useCurrentFrame();
  const toBlank = interpolate(frame, [30, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const tab2 = frame >= 186;
  const pane = (left: number): React.CSSProperties => ({ position: "absolute", left, top: 52, width: 538, height: 682, overflow: "hidden", background: C.paper });
  const label = (bg: string, fg: string): React.CSSProperties => ({ position: "absolute", top: 12, left: "50%", translate: "-50% 0px", background: bg, color: fg, fontFamily, fontWeight: 700, fontSize: 15, padding: "6px 14px", borderRadius: 999, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,0,0,.25)" });
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Caption step="Step 6" title="Plan new pages" text="For new layouts you'll see the live page next to a blank copy. Comment on what goes where." />
      <Browser url="eightreview.netlify.app/c/blendx">
        <div style={{ position: "absolute", inset: 0, background: "#1e1e1e" }} />
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 52, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", fontFamily, fontSize: 15, color: "#ddd" }}>
          <b style={{ color: "#fff" }}>BlendX</b>
          <span style={{ flex: 1 }} />
          <span style={{ background: tab2 ? "#2c2c2c" : C.yellow, color: tab2 ? "#ccc" : "#1e1e1e", fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}>Blank 1</span>
          <span style={{ background: tab2 ? C.yellow : "#2c2c2c", color: tab2 ? "#1e1e1e" : "#ccc", fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}>Blank 2</span>
          <span style={{ border: "1px dashed #555", padding: "5px 11px", borderRadius: 8 }}>+ New blank</span>
          <span style={{ background: C.blue, color: "#fff", padding: "6px 12px", borderRadius: 8, marginLeft: 8 }}>Side by side</span>
        </div>
        <div style={pane(0)}>
          <div style={{ scale: 0.5, transformOrigin: "0 0", width: 1080, height: 1364 }}>
            <MockSite />
          </div>
          <span style={label("rgba(30,30,30,.9)", "#fff")}>BlendX · Live site</span>
        </div>
        <div style={pane(542)}>
          <div style={{ scale: 0.5, transformOrigin: "0 0", width: 1080, height: 1364 }}>
            <div style={{ position: "absolute", inset: 0, opacity: 1 - toBlank }}>
              <MockSite />
            </div>
            <div style={{ position: "absolute", inset: 0, opacity: toBlank }}>
              <MockSite blank />
            </div>
          </div>
          {frame >= 132 && !tab2 ? <Pin x={420} y={240} n={1} /> : null}
          <span style={label(C.yellow, "#1e1e1e")}>BlendX · Blank Page {tab2 ? 2 : 1}</span>
        </div>
        <Cursor
          path={[
            { f: 60, x: 300, y: 500 },
            { f: 120, x: 964, y: 248 },
            { f: 150, x: 964, y: 248 },
            { f: 180, x: 715, y: 26 },
            { f: 230, x: 715, y: 26 },
          ]}
          clicks={[128, 184]}
        />
      </Browser>
    </AbsoluteFill>
  );
};
