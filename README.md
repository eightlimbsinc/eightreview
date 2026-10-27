# EightReview

Figma-style comments on live staging sites. Send a client one link; they see the real
page with a comment layer on top:

- **Comment anywhere** — press `C` (or the Comment button), click any text or image, leave a note. Pins stick to the element, so they stay put across screen sizes. Threads support replies and resolve.
- **Approve / Needs edits per section** — every `<section>` gets a chip; progress shows in the toolbar.
- **✨ SEO-optimize** — the client types new copy or an instruction ("pls select 4: …") and Claude returns three SEO-friendly versions that respect the element type (H1, stat label, body…) and the page's target keywords. They pick one; the team sees both the note and the chosen copy.
- **Team dashboard** at `/` — create review links, see section status, filter copy changes, copy text, export everything as Markdown.

No code is added to Webflow: `/r/:id` fetches the staging page server-side, injects the
overlay, and serves it from this domain.

## Deploy on Netlify

1. **Add new site → Import from Git →** pick `eightlimbsinc/eightreview`. Netlify reads `netlify.toml`; there's no build step.
2. **Site configuration → Environment variables:**
   | Variable | Required | What |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | for ✨ SEO | Claude API key from console.anthropic.com |
   | `ADMIN_TOKEN` | recommended | Any secret string. Required to create/edit/delete review pages from the dashboard (click **Admin token** on the dashboard to enter it). Clients never need it. |
3. Deploy. Storage is Netlify Blobs — enabled automatically, nothing to set up.
4. Open the site, add `https://blend360new.webflow.io/about-v2` as a review page, and send the client link.

## Local development

```bash
npm install
npm run dev          # http://localhost:8888, data stored in .data/
ANTHROPIC_API_KEY=sk-ant-... npm run dev   # with AI suggestions
```

`fixtures/about.html` is a mock page — create a review page with URL
`http://localhost:8888/fixtures/about.html` to try it offline. `netlify dev` also works.

## How it fits together

```
public/index.html, dashboard.js   team dashboard
public/overlay/overlay.js         comment layer (shadow DOM, injected into the staging page)
netlify/functions/review.mjs      GET /r/:id         fetch staging HTML + inject overlay
netlify/functions/pages.mjs       /api/pages         review pages (admin)
netlify/functions/comments.mjs    /api/comments      pins, replies, resolve
netlify/functions/status.mjs      /api/status        section approvals
netlify/functions/seo.mjs         /api/seo           Claude copy suggestions
```

Notes:
- Sections are detected from `<section>` tags (Webflow's default). Add `data-review-section="name"` to any element to make it a reviewable section explicitly.
- Review links are unguessable IDs, not passwords — anyone with the link can comment.
- Links to *other* pages open the original staging site (outside the review layer).
