# Hammad Shahid — Interactive Portfolio

An interactive, avatar-guided single-page portfolio. A 3D character (Three.js)
lives **inside each section** — never overlapping content — and choreographs a
short moment per scene: waving on the hero, walking in on About, putting on
glasses mid-stride on Experience, pulling a laptop out of his bag on Projects,
and sitting down at a table in a shirt and tie for the closing accountability
line. Speech bubbles narrate; there is **no voice audio**.

No build step. Three.js is bundled locally (`js/three.min.js`) — works offline.

## Structure

```
├── index.html          # all content + one canvas per section (data-scene)
├── css/styles.css      # design system (tokens in :root) + avatar slots
├── js/three.min.js     # Three.js r134 bundled locally (no CDN needed)
├── js/avatar.js        # scene system: rig, walk cycle, choreography
├── js/main.js          # scroll-driven scene switching, bubbles, stats, nav
└── assets/resume.pdf   # download link target (replace with your latest)
```

## How the scenes work

- Each section has `data-scene` on the `<section>` and a matching
  `<canvas data-scene="…">` inside its avatar slot.
- `js/main.js` watches sections with an IntersectionObserver. The active
  section's bubble types out a line, then auto-hides after 8s.
- `js/avatar.js` defines per-scene config in `SCENE_CFG` (camera, scale,
  choreography) and accessories in `ACCESSORY_MAP`:
  - `hero` → waves · `about` → walks in · `experience` → walks, glasses on
  - `projects` → laptop out of the bag · `skills` → points · `closing` → sits, shirt & tie
- Scenes are built lazily and animate **only while visible** (performance).
- Edit speech lines in `LINES` at the top of `js/main.js`.
- No WebGL? Each slot falls back to a flat SVG avatar that still swaps
  accessories (`data-fallback`).

## Deploy to GitHub Pages (when ready)

1. Create a repository, e.g. `hammad-shahid-portfolio`.
2. Push these files:
   ```bash
   git init
   git add .
   git commit -m "Portfolio"
   git branch -M main
   git remote add origin https://github.com/hammads22/hammad-shahid-portfolio.git
   git push -u origin main
   ```
3. Repo → **Settings → Pages → Source: Deploy from a branch → main / (root)** → Save.
4. Live at `https://hammads22.github.io/hammad-shahid-portfolio/`.

## Custom domain (optional)

Add a `CNAME` file with your domain and point DNS at GitHub Pages
(`185.199.108.153` – `185.199.111.153`).

## Editing

- Colors/fonts/radii: `:root` tokens in `css/styles.css`.
- Contact: `index.html` (hero actions, closing section, footer).
- Resume PDF: replace `assets/resume.pdf` (the download button points here).
- Avatar look: rig geometry and materials in `js/avatar.js` (`buildRig`).
- **After changing `css/styles.css`, `js/main.js`, `js/avatar.js` or `js/three.min.js`, bump the `?v=` query string on every matching link in `index.html`** (css link, main.js script tag, and the three.min.js/avatar.js calls in the inline loader). Without it, browsers serve the stale cached file and CSS/JS fixes never appear.
