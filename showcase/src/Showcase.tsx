import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Approve } from "./scenes/Approve";
import { Blank } from "./scenes/Blank";
import { Comment } from "./scenes/Comment";
import { Highlight } from "./scenes/Highlight";
import { Intro } from "./scenes/Intro";
import { Outro } from "./scenes/Outro";
import { Portal } from "./scenes/Portal";
import { Suggest } from "./scenes/Suggest";

const FADE = 15;
const VO_DELAY = 10;

// Client walkthrough: 8 scenes, each with its voiceover line (public/voiceover/,
// script in voiceover/lines.json). Durations leave room for the narration.
// Comment -> Approve -> Suggest share the same page, so they cut without a fade.
const SCENES = [
  { name: "Intro", C: Intro, frames: 205, vo: "01-intro", fadeAfter: true },
  { name: "Portal", C: Portal, frames: 200, vo: "02-portal", fadeAfter: true },
  { name: "Highlight", C: Highlight, frames: 190, vo: "03-highlight", fadeAfter: false },
  { name: "Comment", C: Comment, frames: 270, vo: "04-comment", fadeAfter: false },
  { name: "Approve", C: Approve, frames: 170, vo: "05-approve", fadeAfter: false },
  { name: "Suggest", C: Suggest, frames: 370, vo: "06-suggest", fadeAfter: true },
  { name: "Blank", C: Blank, frames: 240, vo: "07-blank", fadeAfter: true },
  { name: "Outro", C: Outro, frames: 200, vo: "08-outro", fadeAfter: false },
];

export const Showcase: React.FC = () => (
  <TransitionSeries>
    {SCENES.flatMap(({ name, C, frames, vo, fadeAfter }) => [
      <TransitionSeries.Sequence key={name} name={name} durationInFrames={frames}>
        <C />
        <Audio from={VO_DELAY} src={staticFile(`voiceover/${vo}.mp3`)} />
      </TransitionSeries.Sequence>,
      ...(fadeAfter
        ? [<TransitionSeries.Transition key={`${name}-fade`} presentation={fade()} timing={linearTiming({ durationInFrames: FADE })} />]
        : []),
    ])}
  </TransitionSeries>
);

export const SHOWCASE_FRAMES =
  SCENES.reduce((sum, s) => sum + s.frames, 0) - SCENES.filter((s) => s.fadeAfter).length * FADE;
