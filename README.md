# Waterplay

A cosy, low-poly, open-water multiplayer boat game. Sail between floating platforms, haul cargo, fish, race and help each other out.

**Play in your browser:** https://digitalethosglobalgaming.github.io/waterplay/

Controls: **W/S** throttle, **A/D** steer, **Shift** boost, drag the mouse to look. On a gamepad: **RT/LT** throttle, **left stick** steer, **A** boost, **right stick** look.

## Status

- **M0 — Scaffold:** done
- **M1 — Boat in water:** Gerstner waves shared by physics and shader, a buoyant speedboat with weighted handling, a chase camera, a day/night cycle and live tuning
- **Next:** M2 — wakes

The design and roadmap are in [docs/architecture.md](docs/architecture.md).

## Development

Requires Node 24.

```sh
npm install
npm run dev          # browser at http://localhost:5173 (tuning panel top right)
npm run dev:desktop  # Electron with hot reload and session restore
npm run check        # typecheck + lint + tests
```

Every push to `main` is checked, built and deployed to GitHub Pages by `.github/workflows/pages.yml`.

Art is the [Kenney Watercraft Kit](https://kenney.nl/assets/watercraft-kit) (CC0).
