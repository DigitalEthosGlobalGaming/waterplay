import { WebPlatform } from '../../src/adapters/platform/web/web-platform.ts';
import { PeerJsTransport } from '../../src/adapters/transport/peerjs/peerjs-transport.ts';
import { Game } from '../../src/app/game.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const uiRoot = document.querySelector<HTMLElement>('#ui');
if (!canvas || !uiRoot) throw new Error('#game canvas or #ui missing');

const game = await Game.create({
  canvas,
  uiRoot,
  platform: new WebPlatform(),
  seed: 1,
  createTransport: () => new PeerJsTransport(),
});

if (import.meta.env.DEV) {
  // Dynamic import keeps all of src/dev out of production bundles (§13.4.9).
  const { installDevSession } = await import('../../src/dev/dev-session.ts');
  const { installTuningGui } = await import('../../src/dev/tuning-gui.ts');
  installTuningGui(game, installDevSession(game));
  // Console / automation handle. Dev only.
  (window as unknown as { waterplay: Game }).waterplay = game;
}

// Invite links (?join=CODE) and hosts refreshing their tab.
game.multiplayer.resumeFromPage();
game.start();
canvas.focus();
