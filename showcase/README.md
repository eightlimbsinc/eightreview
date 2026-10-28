# EightReview client showcase (Remotion)

A ~53-second, 1920×1080 walkthrough video for clients: open the review link → look for
yellow boxes → comment → approve → suggested copy → blank layouts.

## Preview and edit

```bash
cd showcase
npm install
npx remotion studio        # opens the Studio; pick "EightReviewShowcase"
```

Each scene is its own composition under **Showcase-Scenes** (Intro, Portal, Highlight,
Comment, Approve, Suggest, Blank, Outro), so it can be previewed and edited on its own.
Captions live in `src/scenes/*.tsx` (`<Caption step title text />`); brand colours and
the font are in `src/theme.ts`.

## Render

```bash
npx remotion render EightReviewShowcase out/eightreview-client-guide.mp4
```

The Inter font is bundled in `public/fonts`, so rendering doesn't need Google Fonts.
