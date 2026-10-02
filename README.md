# Waterplay

A cosy, low-poly, open-water multiplayer boat game. Sail between floating platforms, haul cargo, fish, race and help each other out.

**Play in your browser:** https://digitalethosglobalgaming.github.io/waterplay/

Controls: **W/S** throttle, **A/D** steer, **Shift** boost, drag the mouse to look, **Esc** menu. On a gamepad: **RT/LT** throttle, **left stick** steer, **A** boost, **right stick** look, **Start** menu.

Change your boat from the menu: **Boat** lists every boat with its speed, acceleration, turning, weight and cargo.

## Playing with friends

Open the menu (**Esc** / **Start**) and choose **Host a game**. You get a code like `K7M-Q4X`. Use **Copy invite link** and send the link to your friends. Opening it drops them straight into your game. They can also choose **Join a game** and type the code.

- Players connect directly to the host over WebRTC. [PeerJS](https://peerjs.com)'s free server only introduces them.
- If the host refreshes, everyone reconnects to the same code automatically.
- Some strict networks (some offices, schools and mobile carriers) block direct connections and need a TURN relay. To add one, set `VITE_TURN_URL` (comma-separated), `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` at build time. Cloudflare and Metered offer free tiers; both need an account.

## Status

- **M0 — Scaffold:** done
- **M1 — Boat in water:** Gerstner waves shared by physics and shader, a buoyant speedboat with weighted handling, a chase camera, a day/night cycle and live tuning
- **M3 — Multiplayer (part 1):** host/join with share codes and invite links, smooth remote boats, bumping, shared world clock, controller-friendly menu
- **M2 — Wakes:** every boat leaves a V-shaped wake with foam, and other boats' wakes (including friends') rock you
- **Boats:** pick from five boats in the menu (speedboat, racer, fan boat, fishing boat, tug), each with its own speed, handling, weight and wake
- **Next:** M3 part 2 (dev relay, multi-instance dev tooling), then M4 — large world

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
