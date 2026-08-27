# Hex conquest

A small turn-based strategy game on a hex map — play solo against the computer, hot-seat on one
device, or take turns with friends through a shared space. Built as an example app for
[immediately.run](https://immediately.run).

**Try it:** <https://immediately.run/present/github/immediately-run/hex-conquest/main/files/src/App.tsx>

## The game

- **Map.** Pointy-top hexes (9×7, 11×9 or 15×11) with seeded random terrain: plains (1 move),
  forest (2 moves, +1 defence), hills (2 moves, +2 defence) and water (impassable). A few neutral
  cities are scattered around — walk a combat unit in to claim one.
- **Players.** 2–4, each starting with a city and a warrior. Any seat can be human or AI.
- **Units.** Settler (founds a city, 3+ hexes from any other), warrior (att 3 / def 2, captures
  cities) and archer (att 3 / def 1, shoots 2 hexes away without retaliation). Units heal when they
  rest; more inside a friendly city.
- **Cities.** Build one thing at a time (a unit or walls) from shields, grow every 5 turns, and yield
  gold. Gold buys units or walls outright. Walls give defenders +2.
- **Combat.** Attack vs defence + terrain/city/walls bonus. The dice come from a seeded RNG stored in
  the game state, so every client (and every replay) gets the same result.
- **Winning.** Capture every rival city, or hold the most cities when the turn limit runs out.

Controls: tap a unit, then a lit hex to move or a red-outlined enemy to attack. Tap a city to pick
production or buy. Drag to pan, pinch / scroll to zoom. Works at phone size.

## How data is stored

Everything is files on the immediately.run filesystem — no server.

```
<store>/games/<gameId>/game.json            settings, seats (human/AI), seed — immutable
<store>/games/<gameId>/players/<slot>.json  seat claim: { login, claimedAt }
<store>/games/<gameId>/turns/<NNNN>.json    full game state after N completed player-turns
```

Solo and hot-seat games live in your private per-app store. Turn files are never rewritten: only the
player whose turn it is writes the *next* number, so last-write-wins on a shared space can't clobber
anyone's move. AI turns are deterministic, so if two clients both compute one they write identical
files. Moves inside a turn are kept in memory until you press **End turn**.

## Playing with others

1. In the lobby, **Create a shared space** (or **Open a shared space** to pick an existing one).
   The app remembers the space and re-opens it next time.
2. Share the space with your friends from the platform's Spaces UI — the app can't send invites.
3. Start a game in the **Shared** tab. You take the first human seat; others press
   **Join as …** on the game card (or **Play as …** inside the game) to claim an open seat.
4. When it's your turn you play and end it; otherwise the screen says *Waiting for @login…* and
   polls the space every 3 s for the next turn file.

Several humans in a *private* game is hot-seat on one device. Note: a space created in-app currently
has no durable grant on the host — if the shared tab is gone after a reload, open it again with
**Open a shared space**.

## Local development

```bash
npm install
npm run dev     # vite; data goes to ./devfs-playground (git-ignored)
npm test        # engine unit tests (node:test after a type-check)
npm run build && npm run lint
```

Rules live in `src/lib/engine.ts` (pure functions), the bot in `src/lib/ai.ts`, hex math in
`src/lib/hex.ts`, persistence in `src/lib/store.ts` + `src/lib/games.ts`. `CLAUDE.md` lists the
platform rules this repo follows.
