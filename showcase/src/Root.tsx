import { Composition, Folder } from "remotion";
import { Approve } from "./scenes/Approve";
import { Blank } from "./scenes/Blank";
import { Comment } from "./scenes/Comment";
import { Highlight } from "./scenes/Highlight";
import { Intro } from "./scenes/Intro";
import { Outro } from "./scenes/Outro";
import { Portal } from "./scenes/Portal";
import { Suggest } from "./scenes/Suggest";
import { Showcase, SHOWCASE_FRAMES } from "./Showcase";

const base = { width: 1920, height: 1080, fps: 30 };

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Showcase-Scenes">
      <Composition id="Intro" component={Intro} durationInFrames={130} {...base} />
      <Composition id="Portal" component={Portal} durationInFrames={200} {...base} />
      <Composition id="Highlight" component={Highlight} durationInFrames={170} {...base} />
      <Composition id="Comment" component={Comment} durationInFrames={270} {...base} />
      <Composition id="Approve" component={Approve} durationInFrames={170} {...base} />
      <Composition id="Suggest" component={Suggest} durationInFrames={300} {...base} />
      <Composition id="Blank" component={Blank} durationInFrames={240} {...base} />
      <Composition id="Outro" component={Outro} durationInFrames={170} {...base} />
    </Folder>
    <Composition id="EightReviewShowcase" component={Showcase} durationInFrames={SHOWCASE_FRAMES} {...base} />
  </>
);
