import { Img, staticFile } from "remotion";
import { C, fontFamily } from "../theme";

// Pieces of the review layer drawn on top of the mock page (content coordinates).

export const Toolbar: React.FC<{ comment?: boolean; progress?: string; done?: boolean }> = ({ comment, progress = "0/1 to review", done }) => (
  <div style={{ position: "absolute", left: "50%", bottom: 22, translate: "-50% 0px", display: "flex", alignItems: "center", gap: 6, background: C.panel, color: "#fff", padding: 7, borderRadius: 14, fontFamily, fontSize: 16, boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>
    <Img src={staticFile("mark-64.png")} style={{ width: 30, height: 30, borderRadius: 6, margin: "0 6px" }} />
    <span style={{ padding: "8px 14px", borderRadius: 9, background: comment ? C.blue : "transparent" }}>💬 Comment</span>
    <span style={{ padding: "8px 14px", borderRadius: 9, background: C.blue }}>✓ Sections</span>
    <span style={{ padding: "0 12px", color: done ? "#4ade80" : "#bbb", fontSize: 14 }}>{progress}</span>
  </div>
);

export const Chip: React.FC<{ x: number; y: number; label: string; state?: "none" | "approved" | "edits"; suggest?: boolean }> = ({ x, y, label, state = "none", suggest }) => (
  <div style={{ position: "absolute", left: x, top: y, translate: "-100% 0px", display: "flex", alignItems: "center", gap: 5, background: "rgba(30,30,30,.94)", color: "#fff", borderRadius: 11, padding: 5, fontFamily, fontSize: 15, boxShadow: `0 0 0 2px ${state === "approved" ? C.green : C.yellow}, 0 6px 16px rgba(0,0,0,.25)`, whiteSpace: "nowrap" }}>
    <span style={{ color: "#ccc", padding: "0 8px" }}>{label}</span>
    {suggest ? <span style={{ background: C.yellow, color: "#1e1e1e", fontWeight: 700, borderRadius: 8, padding: "6px 11px" }}>💡 Suggested copy</span> : null}
    <span style={{ background: state === "approved" ? C.green : "#3a3a3a", borderRadius: 8, padding: "6px 11px" }}>✓ Approve</span>
    <span style={{ background: state === "edits" ? C.yellow : "#3a3a3a", color: state === "edits" ? "#1e1e1e" : "#fff", borderRadius: 8, padding: "6px 11px" }}>✎ Needs edits</span>
  </div>
);

export const Highlight: React.FC<{ x: number; y: number; w: number; h: number; state?: "waiting" | "approved"; tag?: string }> = ({ x, y, w, h, state = "waiting", tag }) => {
  const color = state === "approved" ? C.green : C.yellow;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 10, outline: `4px solid ${color}`, outlineOffset: -4, background: state === "approved" ? "rgba(20,174,92,.05)" : "rgba(255,199,0,.08)" }}>
      {tag ? (
        <span style={{ position: "absolute", left: 0, top: -36, background: color, color: state === "approved" ? "#fff" : "#1e1e1e", fontFamily, fontWeight: 700, fontSize: 15, padding: "6px 12px", borderRadius: 7, whiteSpace: "nowrap" }}>{tag}</span>
      ) : null}
    </div>
  );
};

export const Pin: React.FC<{ x: number; y: number; n: number; initials?: string }> = ({ x, y, n, initials = "SC" }) => (
  <div style={{ position: "absolute", left: x, top: y, translate: "-4px -100%", display: "flex", alignItems: "center", gap: 5, background: "#fff", borderRadius: "18px 18px 18px 3px", padding: "4px 10px 4px 4px", boxShadow: "0 3px 10px rgba(0,0,0,.3)", fontFamily, fontSize: 15, fontWeight: 700, color: "#1e1e1e" }}>
    <span style={{ width: 26, height: 26, borderRadius: 13, background: "#3b5bdb", color: "#fff", fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials}</span>
    {n}
  </div>
);

export const Toast: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: "absolute", left: "50%", bottom: 92, translate: "-50% 0px", background: C.panel, color: "#fff", fontFamily, fontSize: 18, padding: "10px 18px", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.3)", whiteSpace: "nowrap" }}>{text}</div>
);

