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

// Client walkthrough: 8 scenes, 15-frame crossfades between most of them.
// Comment -> Approve -> Suggest share the same page, so they cut without a fade.
export const Showcase: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="Intro" durationInFrames={130}>
      <Intro />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
    <TransitionSeries.Sequence name="Portal" durationInFrames={200}>
      <Portal />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
    <TransitionSeries.Sequence name="Highlight" durationInFrames={170}>
      <Highlight />
    </TransitionSeries.Sequence>
    <TransitionSeries.Sequence name="Comment" durationInFrames={270}>
      <Comment />
    </TransitionSeries.Sequence>
    <TransitionSeries.Sequence name="Approve" durationInFrames={170}>
      <Approve />
    </TransitionSeries.Sequence>
    <TransitionSeries.Sequence name="Suggest" durationInFrames={300}>
      <Suggest />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
    <TransitionSeries.Sequence name="Blank" durationInFrames={240}>
      <Blank />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
    <TransitionSeries.Sequence name="Outro" durationInFrames={170}>
      <Outro />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);

// 130+200+170+270+170+300+240+170 minus four 15-frame fades.
export const SHOWCASE_FRAMES = 1650 - 60;
