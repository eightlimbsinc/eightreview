import { interpolate, useCurrentFrame } from "remotion";
import { BROWSER, C, ease, fontFamily } from "../theme";

// A browser window that slides up into place; children render in the page area.
export const Browser: React.FC<{ url: string; children: React.ReactNode; enter?: boolean }> = ({ url, children, enter = true }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: BROWSER.x,
        top: BROWSER.y,
        width: BROWSER.w,
        height: BROWSER.h,
        borderRadius: 18,
        overflow: "hidden",
        background: C.paper,
        boxShadow: "0 40px 120px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)",
        fontFamily,
        opacity: enter ? interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }) : 1,
        translate: enter
          ? interpolate(frame, [0, 26], ["0px 60px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease })
          : "0px 0px",
      }}
    >
      <div style={{ height: BROWSER.bar, background: "#2a2a2c", display: "flex", alignItems: "center", gap: 9, padding: "0 18px" }}>
        <span style={{ width: 13, height: 13, borderRadius: 7, background: "#ff5f57" }} />
        <span style={{ width: 13, height: 13, borderRadius: 7, background: "#febc2e" }} />
        <span style={{ width: 13, height: 13, borderRadius: 7, background: "#28c840" }} />
        <div style={{ marginLeft: 18, flex: 1, height: 28, borderRadius: 8, background: "#1c1c1e", color: "#a8a8ad", fontSize: 16, display: "flex", alignItems: "center", padding: "0 14px" }}>
          🔒 {url}
        </div>
      </div>
      <div style={{ position: "relative", height: BROWSER.h - BROWSER.bar, overflow: "hidden" }}>{children}</div>
    </div>
  );
};
