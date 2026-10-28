import { C, fontFamily } from "../theme";

// Text that turns into a grey placeholder bar on blank wireframes (same size and position).
export const T: React.FC<{ blank?: boolean; children: React.ReactNode }> = ({ blank, children }) =>
  blank ? (
    <span style={{ color: "transparent", background: "rgba(127,127,127,.3)", borderRadius: 5, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
      {children}
    </span>
  ) : (
    <span>{children}</span>
  );

// Fixed-layout mock of a client page (content coordinates: 1080 x 734).
// Key rects used by scenes: clients section x16-1064 y258-532; stat card i: x 40+252i, y 390-500.
export const MockSite: React.FC<{ blank?: boolean; statLabel?: string; width?: number }> = ({ blank, statLabel = "Lorem Ipsum", width = 1080 }) => {
  const stats = [
    ["12", "Offices Worldwide"],
    ["9", "Years on the market"],
    ["160K", "Satisfied Clients"],
    ["XX", statLabel],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, width, background: C.paper, fontFamily, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 60, background: C.navy, display: "flex", alignItems: "center", padding: "0 28px", gap: 26, color: "#fff", fontSize: 17 }}>
        <b style={{ fontSize: 24, letterSpacing: -0.5 }}><T blank={blank}>Blend</T></b>
        <span style={{ flex: 1 }} />
        <T blank={blank}>About</T>
        <T blank={blank}>Solutions</T>
        <T blank={blank}>Industries</T>
        <span style={{ border: `2px solid ${C.teal}`, borderRadius: 20, padding: "5px 16px", color: C.teal }}><T blank={blank}>Contact Us</T></span>
      </div>
      <div style={{ position: "absolute", left: 0, top: 60, right: 0, height: 190, background: "#0f1a20" }}>
        <div style={{ position: "absolute", left: 40, top: 22, width: 760, color: "#fff", fontSize: 38, fontWeight: 800, lineHeight: 1.15, letterSpacing: -0.8 }}>
          <T blank={blank}>Built to Help Enterprises Turn Complexity Into Impact</T>
        </div>
        <div style={{ position: "absolute", left: 40, top: 116, width: 620, color: "#cfd6da", fontSize: 17, lineHeight: 1.4 }}>
          <T blank={blank}>Blend360 brings together AI, data, analytics, strategy, and technology experts to solve complex business challenges.</T>
        </div>
      </div>
      <div style={{ position: "absolute", left: 40, top: 280, width: 440, color: "#1b1b1b", fontSize: 40, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.8 }}>
        <T blank={blank}>Our Clients Come First</T>
      </div>
      <div style={{ position: "absolute", left: 560, top: 284, width: 480, color: "#333", fontSize: 18, lineHeight: 1.5 }}>
        <span style={{ color: blank ? undefined : "#0a8f9c" }}><T blank={blank}>Everything we do starts with a simple belief: our clients are the hero of the story.</T></span>{" "}
        <T blank={blank}>Their goals shape our strategy.</T>
      </div>
      {stats.map(([n, label], i) => (
        <div key={i} style={{ position: "absolute", left: 40 + i * 252, top: 390, width: 236, height: 110, background: "#fff", borderRadius: 14, boxShadow: "0 1px 0 rgba(0,0,0,.04)" }}>
          <div style={{ position: "absolute", left: 20, top: 12, fontSize: 44, color: C.teal, fontWeight: 300 }}><T blank={blank}>{n}</T></div>
          <div style={{ position: "absolute", left: 20, top: 72, fontSize: 18, color: "#222" }}><T blank={blank}>{label}</T></div>
        </div>
      ))}
      <div style={{ position: "absolute", left: 40, top: 570, color: "#1b1b1b", fontSize: 34, fontWeight: 700 }}>
        <T blank={blank}>Company Milestones</T>
      </div>
      <div style={{ position: "absolute", left: 40, top: 626, color: "#333", fontSize: 18, lineHeight: 1.7 }}>
        <div><T blank={blank}>• Acquired US-based Futureproof AI</T></div>
        <div><T blank={blank}>• Named in the Inc. 5000 fastest-growing companies</T></div>
      </div>
    </div>
  );
};
