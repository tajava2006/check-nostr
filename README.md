# Check Nostr

Live: https://tajava2006.github.io/check-nostr

A small web app to check if a Nostr event exists on selected relays, and to publish the event to relays where it is absent. Built by AI (vibe coding).

Features
- Enter an event id (hex64, nevent/note) and see per-relay:
  - connection status
  - whether the event exists
  - first raw event JSON received
- Enter an author pubkey (hex64, npub, nprofile) to load:
  - profile (kind 0)
  - outbox relays (kind 10002) and append write-capable relays after defaults
- One-click publish: publish the currently checked event to a specific relay
  - success updates the status to Present
  - failure shows the reason

Live Demo
- https://tajava2006.github.io/check-nostr

Getting Started
1) Install
   npm install

2) Dev
   npm run dev

3) Build
   npm run build

Deploy to GitHub Pages
This project is set up for gh-pages. Make sure vite.config.ts has:
  base: '/check-nostr/'

And package.json has scripts like:
  "predeploy": "npm run build",
  "deploy": "gh-pages -d dist"

Then run:
  npm run deploy

Tech Stack
- React + TypeScript + Vite
- nostr-tools
- gh-pages (for deployment)

Notes
- Default relays are kept at the front; outbox write relays are appended after defaults.
- URLs are normalized to avoid duplicates.
