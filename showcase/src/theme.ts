import { loadFont } from "@remotion/fonts";
import { Easing, staticFile } from "remotion";

// Inter (variable font, weights 100-900) bundled in public/fonts so renders don't need the network.
export const fontFamily = "Inter";
loadFont({ family: fontFamily, url: staticFile("fonts/inter-latin.woff2"), weight: "100 900" });

// Eight Limbs brand + the review tool's own colours, so the video matches what clients see.
export const C = {
  ink: "#0b0b0c",
  panel: "#1e1e1e",
  gold: "#c5a455",
  white: "#ffffff",
  paper: "#f6f6f4",
  muted: "#8a8a8a",
  yellow: "#ffc700",
  green: "#14ae5c",
  red: "#f24822",
  blue: "#0d99ff",
  violet: "#6d28d9",
  navy: "#0b2545",
  teal: "#14c4d4",
};

export const ease = Easing.bezier(0.16, 1, 0.3, 1);

// Layout of the browser window used in most scenes (1920x1080 canvas).
export const BROWSER = { x: 760, y: 150, w: 1080, h: 780, bar: 46 };
// Top-left of the page content inside the browser, in canvas pixels.
export const CONTENT = { x: BROWSER.x, y: BROWSER.y + BROWSER.bar };
