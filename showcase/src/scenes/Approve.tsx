import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Browser } from "../ui/Browser";
import { Caption } from "../ui/Caption";
import { Cursor } from "../ui/Cursor";
import { MockSite } from "../ui/MockSite";
import { Chip, Highlight, Pin, Toast, Toolbar } from "../ui/Overlay";
import { C } from "../theme";

export const Approve: React.FC = () => {
  const frame = useCurrentFrame();
  const done = frame >= 64;
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Caption step="Step 4" title="Approve or ask for edits" text="Happy with a section? One click on Approve and it turns green." />
      <Browser url="eightreview.netlify.app/r/about" enter={false}>
        <MockSite />
        <Highlight x={16} y={258} w={1048} h={274} state={done ? "approved" : "waiting"} tag={done ? "✓ Approved" : "● Needs your review · Updated copy"} />
        <Chip x={1064} y={212} label="Our Clients Come First" state={done ? "approved" : "none"} />
        <Pin x={826} y={470} n={1} />
        <Toolbar progress={done ? "1/1 reviewed" : "0/1 to review"} done={done} />
        {done && frame < 150 ? <Toast text="Section approved ✓" /> : null}
        <Cursor path={[{ f: 0, x: 742, y: 552 }, { f: 52, x: 868, y: 232 }, { f: 170, x: 868, y: 232 }]} clicks={[60]} />
      </Browser>
    </AbsoluteFill>
  );
};
