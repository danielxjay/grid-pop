# GridPop!

GridPop! is a browser-based puzzle game built around quick, score-chasing board clears.

The game is built around an `8x8` board and a rotating tray of pieces. Players place shapes to complete rows and columns, clear space, and extend a run for the highest score possible.

## Features

- drag-and-drop and tap-based piece placement
- score, best score, and combo tracking
- animated clear and placement feedback
- optional sound effects
- responsive layouts for desktop, mobile, and landscape orientations
- static deployment support via GitHub Pages

## Tech Stack

- React
- Vite
- Plain CSS
- Local storage for best score persistence

## Getting Started

### Prerequisites

- Node.js 20+ recommended
- npm

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

## How To Play

1. Pick a piece from the tray.
2. Position it on the board.
3. Fill an entire row or column to clear it.
4. Chain clears to keep your combo going.
5. Survive as long as possible without running out of valid placements.

## Controls

- `Mouse / Touch`: drag and place pieces
- `Click / Tap`: select pieces and interact with UI
- `Sound button`: toggle sound effects on or off

## Project Structure

```text
.
├── src/
│   ├── App.jsx
│   ├── game.js
│   ├── main.jsx
│   ├── sound.js
│   └── styles.css
├── index.html
├── package.json
└── vite.config.js
```

## Implementation Notes

- `src/App.jsx` contains the main UI and interaction flow.
- `src/game.js` contains board state, placement rules, preview logic, and score updates.
- `src/sound.js` manages sound playback and persisted sound preferences.
- `src/styles.css` contains layout, board styling, and gameplay animation rules.
- Best score is stored in browser local storage.

## Deployment

This repo is set up for GitHub Pages via GitHub Actions.

- Push to `main`
- Ensure the repository Pages source is set to `GitHub Actions`
- The workflow will build the Vite app and publish `dist`

## License

No license file is included yet. Add one before distributing or accepting outside contributions.
