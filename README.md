# EightReview

Figma-style comments on live staging sites. Group a client's staging pages into a
**project**, send them one link, and they work through every page with a comment layer
on top of the real site:

- **Projects + client portal** — `/p/:id` lists every page with its status (not started / in progress / needs edits / approved) and a "Continue" button. Inside a page, the toolbar has a page switcher with ‹ › and links between staged pages stay inside the review.
- **Bulk add pages** — paste a list of URLs (optionally `Name | URL`), or import from the staging site's `sitemap.xml` and tick the pages to review.
- **Comment anywhere** — press `C` (or the Comment button), click any text or image, leave a note. Pins stick to the element, so they stay put across screen sizes. Threads support replies and resolve.
- **Approve / Needs edits per section** — every `<section>` gets a chip; progress shows in the toolbar.
- **✨ SEO-optimize** — the client types new copy or an instruction ("pls select 4: …") and Claude returns three SEO-friendly versions that respect the element type (H1, stat label, body…) and the page's target keywords. They pick one; the team sees both the note and the chosen copy.
- **Team dashboard** at `/` — projects, pages and their progress; per page: section status, comments, copy changes, Markdown export.

No code is added to Webflow: `/r/:id` fetches the staging page server-side, injects the
overlay, and serves it from this domain.

## Deploy on Netlify

1. **Add new site → Import from Git →** pick `eightlimbsinc/eightreview`. Netlify reads `netlify.toml`; there's no build step.
2. **Site configuration → Environment variables:**
   | Variable | Required | What |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | for ✨ SEO | Claude API key from console.anthropic.com |
   | `STAGING_PASSWORD` | optional | Default Webflow staging password for projects that don't set their own. |
   | `ADMIN_TOKEN` | recommended | Any secret string. Required to create/edit/delete projects and pages from the dashboard (click **Admin token** on the dashboard to enter it). Clients never need it. |
3. Deploy. Storage is Netlify Blobs — enabled automatically, nothing to set up.
4. Open the site, create a project (e.g. "Blend360 website"), add the staging pages, and send the **Copy client link** URL.

## Local development

```bash
npm install
npm run dev          # http://localhost:8888, data stored in .data/
ANTHROPIC_API_KEY=sk-ant-... npm run dev   # with AI suggestions
```

`fixtures/` has mock pages and a sitemap for trying it offline: create a project, then
import `http://localhost:8888/fixtures/sitemap.xml` (or paste
`http://localhost:8888/fixtures/about.html`). `netlify dev` also works.

## How it fits together

```
public/index.html, dashboard.js   team dashboard
public/portal.html, portal.js     client portal (/p/:id)
public/overlay/overlay.js         comment layer (shadow DOM, injected into the staging page)
netlify/functions/review.mjs      GET /r/:id         fetch staging HTML + inject overlay
netlify/functions/projects.mjs    /api/projects      projects (admin; GET one is public for the portal)
netlify/functions/pages.mjs       /api/pages         staging pages, single or bulk (admin)
netlify/functions/sitemap.mjs     /api/sitemap       list URLs from a staging sitemap (admin)
netlify/functions/comments.mjs    /api/comments      pins, replies, resolve
netlify/functions/status.mjs      /api/status        section approvals
netlify/functions/seo.mjs         /api/seo           Claude copy suggestions
```

Notes:
- Sections are detected from `<section>` tags (Webflow's default). Add `data-review-section="name"` to any element to make it a reviewable section explicitly.
- Review links are unguessable IDs, not passwords — anyone with the link can comment.
- Links to pages that aren't in the project open the original staging site (outside the review).
- **Password-protected staging:** set the Webflow site password on the project (dashboard → **Set staging password**). The server logs in through Webflow's password screen and caches the login cookie; the password is never sent to the browser.
- Webflow staging sitemaps need **Site settings → SEO → Auto-generate sitemap** turned on; URLs are mapped onto the staging domain automatically.
