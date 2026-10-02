import { WebPlatform } from '../../src/adapters/platform/web/web-platform.ts';
import { PeerJsTransport } from '../../src/adapters/transport/peerjs/peerjs-transport.ts';
import { Game } from '../../src/app/game.ts';
import type { PeerId, Transport } from '../../src/core/interfaces/transport.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const uiRoot = document.querySelector<HTMLElement>('#ui');
if (!canvas || !uiRoot) throw new Error('#game canvas or #ui missing');

let createTransport: () => Transport = () => new PeerJsTransport();
const devBridge = window.waterplayDesktop?.dev;
if (import.meta.env.DEV && devBridge?.relayUrl) {
  // dev:duo / dev:trio: instances meet on the localhost relay as dev-A, dev-B… (§13.4.5).
  const { DevSocketTransport } = await import(
    '../../src/adapters/transport/devsocket/dev-socket-transport.ts'
  );
  const url = devBridge.relayUrl;
  const id = `dev-${devBridge.instance}` as PeerId;
  createTransport = () => new DevSocketTransport(url, id);
}

const game = await Game.create({
  canvas,
  uiRoot,
  platform: new WebPlatform(),
  seed: 1,
  createTransport,
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
