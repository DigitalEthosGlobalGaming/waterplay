# Waterplay — agent notes

Design doc: `docs/architecture.md`. Read the relevant section before changing a system.

## Commands

- `npm run check` — typecheck + lint (Biome + core purity) + tests. Must pass before committing.
- `npm run dev` — browser dev server (port 5173).
- `npm run dev:desktop` / `dev:duo` / `dev:trio` — Electron instances via `tools/dev-electron.ts` (Vite on 5180+). Add `-- --fresh` to skip session restore; `npm run dev:reset` wipes `.dev-sessions/`.
- `npm run build:desktop && npm run check:bundle` — production build + dev-code leak check.
- Pushing to `main` deploys the web build to GitHub Pages (`.github/workflows/pages.yml`). Asset URLs must stay relative (`base: './'`), since the site lives under `/waterplay/`.

## Rules (§14, abridged)

1. `src/core` is pure: imports only from `src/core` and `src/data`; no DOM, timers, `Math.random`, `Date.now`. Enforced by `tools/check-core-purity.ts`.
2. Rapier, PeerJS and steamworks.js only inside `src/adapters`.
3. The water function exists in TS and GLSL — change both and the golden-value test together.
4. Game code reads actions (`src/input/actions.ts`), never raw keys. Every interaction needs a KBM binding, a gamepad binding and a UI prompt.
5. Every UI screen must be fully controller-usable via `FocusManager`.
6. Tunables live in `src/data` (via `liveTunable`) and are read live, never cached at startup.
7. Shared/world state changes go through the host; clients send requests.
8. Network messages and saves use absolute world coordinates; physics/render use rebased local ones.
9. Seeded RNG (`src/core/sim/rng.ts`) only in core.
10. Add/update tests with every core change; prefer sim tests over E2E.
11. Kenney asset filenames are used as-is; map them to IDs in `src/data/models.ts`.
12. Unsure about a library API? Read its types in `node_modules`, don't guess.
13. New state is either in the session snapshot (`src/app/session.ts`, round-trip test updated, bump `SESSION_SCHEMA_VERSION` on shape changes) or explicitly transient.
14. Dev-only code stays behind `import.meta.env.DEV` (renderer) or `__DEV__` (Electron main/preload).

## Conventions

- Imports use explicit `.ts` extensions.
- Biome formats: 2 spaces, single quotes, width 100.
