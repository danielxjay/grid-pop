# GridPop!

A browser-based puzzle game built around quick, score-chasing board clears. Place pieces, complete lines, and chain clears for as long as you can.

**[Play GridPop!](https://gridpop.app)** &nbsp;·&nbsp; Built by [@dxniel.jxy](https://threads.com/@dxniel.jxy)

---

## How to Play

1. Pick a piece from the tray at the bottom.
2. Drag or tap to place it on the 8×8 board.
3. Fill a complete row or column to clear it.
4. Chain multiple clears in a row to build a combo bonus.
5. The run ends when no valid placements remain.

**Controls**
- **Mouse / Touch** — drag pieces onto the board
- **Tap** — select a piece, then tap a valid cell to place it

---

## Features

- Ranked runs with a global top 10 leaderboard
- Account login to track scores and resume runs across devices
- 9 unlockable themes, earnable through gameplay challenges
- Stats screen with shareable summary card
- Works offline as an installable PWA
- Sound effects with persistent preference
- Responsive layout across mobile, landscape, and desktop

### Themes

Themes are earned in-game, not purchased. Two are free from the start, the rest are unlocked by completing challenges.

| Theme | Unlock Condition |
|---|---|
| Classic | Free |
| Classic Dark | Free |
| Gen Y | Play 50 games |
| DMG | Clear 4 or more lines in a single move |
| Broadcast | Share your stats |
| Y2K | Reach a best score of 20,000 |
| Greige | Finish a run with a score under 500 |
| Summit | Hold any global top 10 spot |
| Crown | Hold the global #1 spot |

Summit and Crown are live. They are revoked if you lose the qualifying position.

---

## Tech Stack

- **React 19** — UI and game state
- **Vite** — build tooling
- **Plain CSS** — no UI framework
- **Supabase** — auth, ranked runs, and leaderboard
- **Workbox / vite-plugin-pwa** — service worker and offline support

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- A Supabase project (optional. the game runs locally without one)

### Install

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

### Environment Variables

To enable ranked runs and accounts, create a `.env` file:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

Without these, the game runs in guest mode. local scoring only and no leaderboard.

---

## Project Structure

```text
.
├── public/
│   └── changelog.json       # Player-facing version history
├── src/
│   ├── App.jsx              # Main UI, game flow, and session handling
│   ├── game.js              # Board state, placement rules, and scoring
│   ├── main.jsx             # App entry point and service worker registration
│   ├── maintenance.js       # Maintenance mode flag
│   ├── MaintenancePage.jsx  # Maintenance screen
│   ├── sound.js             # Sound playback and preferences
│   └── styles.css           # Layout, theming, and animations
├── index.html
├── vite.config.js
└── package.json
```

---

## Deployment

Deploys automatically to GitHub Pages on push to `main`.

- Set the repository Pages source to **GitHub Actions**
- The workflow builds the Vite app and publishes `dist/`
- Set Supabase environment variables as repository secrets if ranked features are needed

---

## License

No license is currently included. All rights reserved until further notice.
