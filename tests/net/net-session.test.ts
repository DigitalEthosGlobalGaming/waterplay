import { describe, expect, it } from 'vitest';
import type { Transport } from '../../src/core/interfaces/transport.ts';
import { wrapDelta } from '../../src/core/net/interpolation.ts';
import { INCOMPATIBLE_MESSAGE } from '../../src/core/net/net-session.ts';
import { netTunables } from '../../src/data/net.ts';
import { simTunables } from '../../src/data/sim.ts';
import { circlePosition, Harness, type Peer, shareCode } from './harness.ts';

const PERIOD = simTunables.worldClockLoopPeriod;
const ROUGH = { latencyMs: 60, jitterMs: 30, lossRate: 0.1 };

async function hostAndJoin(h: Harness, ...clients: Peer[]): Promise<Peer> {
  const host = h.peers[0];
  if (!host) throw new Error('no host');
  await host.session.host();
  for (const c of clients) await c.session.join(shareCode(host));
  await h.run(3);
  return host;
}

const names = (p: Peer) =>
  p.session
    .players()
    .map((x) => `${x.name}${x.isHost ? '*' : ''}`)
    .sort();

const remoteOwners = (p: Peer) =>
  p.session
    .remoteBoats(p.world.worldClock)
    .map((b) => b.key.split('/')[1])
    .sort();

/** A transport speaking a newer protocol version than this build. */
function newerProtocol(t: Transport): Transport {
  return {
    get localId() {
      return t.localId;
    },
    get isHost() {
      return t.isHost;
    },
    host: (code) => t.host(code),
    join: (code) => t.join(code),
    leave: () => t.leave(),
    send: (to, channel, data) => {
      const copy = data.slice();
      copy[0] = 99;
      t.send(to, channel, copy);
    },
    onMessage: (cb) => t.onMessage(cb),
    onPeerJoined: (cb) => t.onPeerJoined(cb),
    onPeerLeft: (cb) => t.onPeerLeft(cb),
    onConnectionStateChanged: (cb) => t.onConnectionStateChanged(cb),
  };
}

describe('NetSession', () => {
  it('a client joins, is welcomed and sees the roster', async () => {
    const h = new Harness(ROUGH);
    h.addPeer('Ana');
    const bo = h.addPeer('Bo');
    const ana = await hostAndJoin(h, bo);

    expect(ana.session.status.kind).toBe('hosting');
    expect(bo.session.status).toEqual({ kind: 'connected', code: shareCode(ana) });
    expect(names(ana)).toEqual(['Ana*', 'Bo']);
    expect(names(bo)).toEqual(['Ana*', 'Bo']);
    expect(ana.notices).toContain('Bo joined');
    expect(bo.notices).toContain("Joined Ana's game");
  });

  it("the client's world clock follows the host's", async () => {
    const h = new Harness(ROUGH);
    h.addPeer('Ana', { startClock: 1000 });
    const bo = h.addPeer('Bo', { startClock: 3 });
    const ana = await hostAndJoin(h, bo);
    await h.run(6);
    const error = wrapDelta(ana.world.worldClock, bo.world.worldClock, PERIOD);
    // Within the one-way latency asymmetry (jitter) plus a step.
    expect(Math.abs(error)).toBeLessThan(0.05);
  });

  it('clock sync works across the loop wrap', async () => {
    const h = new Harness({ latencyMs: 40 });
    h.addPeer('Ana', { startClock: PERIOD - 1 });
    const bo = h.addPeer('Bo', { startClock: 500 });
    const ana = await hostAndJoin(h, bo);
    expect(ana.world.worldClock).toBeLessThan(5);
    const error = wrapDelta(ana.world.worldClock, bo.world.worldClock, PERIOD);
    expect(Math.abs(error)).toBeLessThan(0.03);
  });

  it('replicates boats smoothly despite latency, jitter and loss', async () => {
    const h = new Harness(ROUGH);
    h.addPeer('Ana', { phase: 1 });
    const bo = h.addPeer('Bo');
    const ana = await hostAndJoin(h, bo);

    let worst = 0;
    for (let i = 0; i < 120; i++) {
      await h.run(1 / 60);
      const t = ana.world.worldClock;
      const [remote] = ana.session.remoteBoats(t);
      expect(remote?.key).toMatch(/\/Bo:1$/);
      expect(remote?.name).toBe('Bo');
      if (!remote) continue;
      // Drawn interpolationDelay in the past, on the synced clock.
      const truth = circlePosition(t - netTunables.interpolationDelay).position;
      worst = Math.max(worst, Math.hypot(remote.position.x - truth.x, remote.position.z - truth.z));
    }
    // The boat moves at 6 m/s; this allows roughly 50 ms of total error.
    expect(worst).toBeLessThan(0.3);
  });

  it('relays boats between clients through the host', async () => {
    const h = new Harness(ROUGH);
    h.addPeer('Ana');
    const bo = h.addPeer('Bo', { phase: 2 });
    const cy = h.addPeer('Cy', { phase: 4 });
    const ana = await hostAndJoin(h, bo);
    await cy.session.join(shareCode(ana));
    await h.run(3);

    expect(remoteOwners(ana)).toEqual(['Bo:1', 'Cy:1']);
    expect(remoteOwners(bo)).toEqual(['Ana:1', 'Cy:1']);
    expect(remoteOwners(cy)).toEqual(['Ana:1', 'Bo:1']);
    expect(bo.notices).toContain('Cy joined');
  });

  it('removes a player and their boat when they leave', async () => {
    const h = new Harness(ROUGH);
    h.addPeer('Ana');
    const bo = h.addPeer('Bo');
    const cy = h.addPeer('Cy');
    const ana = await hostAndJoin(h, bo, cy);

    await bo.session.leave();
    await h.run(1);
    expect(bo.session.status.kind).toBe('offline');
    expect(names(ana)).toEqual(['Ana*', 'Cy']);
    expect(names(cy)).toEqual(['Ana*', 'Cy']);
    expect(remoteOwners(ana)).toEqual(['Cy:1']);
    expect(remoteOwners(cy)).toEqual(['Ana:1']);
    expect(ana.notices).toContain('Bo left');
    expect(cy.notices).toContain('Bo left');
  });

  it('a boat that disappears from its owner disappears for everyone', async () => {
    const h = new Harness();
    h.addPeer('Ana');
    const bo = h.addPeer('Bo');
    const ana = await hostAndJoin(h, bo);
    bo.world.hasBoat = false;
    await h.run(netTunables.staleTimeout + 1);
    expect(remoteOwners(ana)).toEqual([]);
  });

  it('clients reconnect when the host comes back with the same code', async () => {
    const h = new Harness({ latencyMs: 30 });
    h.addPeer('Ana');
    const bo = h.addPeer('Bo');
    const ana = await hostAndJoin(h, bo);
    const code = shareCode(ana);

    // The host refreshes the page: gone, then back on the same code a few seconds later.
    await ana.session.leave();
    await h.run(1);
    expect(bo.session.status.kind).toBe('reconnecting');
    expect(remoteOwners(bo)).toEqual([]);
    await h.run(3);
    await ana.session.host(code);
    expect(shareCode(ana)).toBe(code);
    await h.run(4);

    expect(bo.session.status).toEqual({ kind: 'connected', code });
    expect(bo.notices).toContain("Back in Ana's game");
    expect(remoteOwners(ana)).toEqual(['Bo:1']);
  });

  it('clients give up after the reconnect window', async () => {
    const h = new Harness({ latencyMs: 30 });
    h.addPeer('Ana');
    const bo = h.addPeer('Bo');
    const ana = await hostAndJoin(h, bo);
    await ana.session.leave();
    await h.run(netTunables.reconnectWindow + netTunables.reconnectInterval + 1);
    expect(bo.session.status).toEqual({ kind: 'offline', error: 'Lost connection to the host.' });
  });

  it('explains bad and unknown codes', async () => {
    const h = new Harness();
    const bo = h.addPeer('Bo');
    await bo.session.join('nope');
    expect(bo.session.status).toMatchObject({
      kind: 'offline',
      error: expect.stringContaining('K7M-Q4X'),
    });
    await bo.session.join('ABC-DEF');
    expect(bo.session.status).toMatchObject({
      kind: 'offline',
      error: expect.stringContaining('ABCDEF'),
    });
  });

  it.each([
    ['client', 1],
    ['host', 0],
  ])('refuses to play across protocol versions (%s is newer)', async (_who, newer) => {
    const h = new Harness({ latencyMs: 20 });
    h.addPeer('Ana', newer === 0 ? { wrap: newerProtocol } : {});
    const bo = h.addPeer('Bo', newer === 1 ? { wrap: newerProtocol } : {});
    const ana = await hostAndJoin(h, bo);
    expect(bo.session.status).toEqual({ kind: 'offline', error: INCOMPATIBLE_MESSAGE });
    expect(names(ana)).toEqual(['Ana*']);
  });

  it('renames reach everyone', async () => {
    const h = new Harness({ latencyMs: 20 });
    h.addPeer('Ana');
    const bo = h.addPeer('Bo');
    const cy = h.addPeer('Cy');
    const ana = await hostAndJoin(h, bo, cy);
    bo.session.setName('  Captain Bo\u0007 ');
    await h.run(0.5);
    expect(names(ana)).toContain('Captain Bo');
    expect(names(cy)).toContain('Captain Bo');
  });
});
