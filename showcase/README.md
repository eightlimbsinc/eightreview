# EightReview client showcase (Remotion)

A ~60-second, 1920×1080 narrated walkthrough video for clients: open the review link → look for
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

## Voiceover

Each scene plays its narration line from `public/voiceover/*.mp3` (script in
`voiceover/lines.json`, timing in `src/Showcase.tsx`). The voice is Kokoro TTS
(`af_heart`), generated offline with `voiceover/generate.py`; to swap in a recorded
or ElevenLabs voice, drop new MP3s with the same names and adjust scene lengths if a
line gets longer.

The Inter font is bundled in `public/fonts`, so rendering doesn't need Google Fonts.
