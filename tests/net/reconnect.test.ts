import { describe, expect, it } from 'vitest';
import { INCOMPATIBLE_MESSAGE } from '../../src/core/net/net-session.ts';
import { Harness, type Peer } from './harness.ts';

/**
 * Multi-instance resync choreography (§13.4.5) over the loopback network: dev
 * instances with fixed peer ids and a fixed code reload in any order and end
 * up back in one synced game.
 */
const CODE = 'DEVDEV';

/**
 * a draws b's boat where it really is now (within the interpolation delay),
 * not frozen at some stale last-known state.
 */
function sees(a: Peer, b: Peer): boolean {
  const real = b.world.ownedBoats()[0]?.position;
  const drawn = a.session
    .remoteBoats(a.world.worldClock)
    .find((r) => r.key.endsWith(`/${b.world.boatId}`))?.position;
  if (!real || !drawn) return false;
  // Boats circle at 6 m/s; 0.12 s interpolation delay plus latency is about a metre.
  return Math.hypot(real.x - drawn.x, real.z - drawn.z) < 2;
}

function connected(p: Peer): boolean {
  return p.session.online;
}

async function devPair(opts: { strictBuild?: boolean } = {}) {
  const h = new Harness({ latencyMs: 20 });
  const a = h.addPeer('A', { peerId: 'dev-A', ...opts });
  const b = h.addPeer('B', { peerId: 'dev-B', phase: 2, ...opts });
  await a.session.host(CODE);
  await b.session.join(CODE, { keepTrying: true });
  await h.run(1);
  expect(sees(a, b) && sees(b, a)).toBe(true);
  return { h, a, b };
}

describe('dev resync choreography', () => {
  it('a client that reloads comes back as the same player', async () => {
    const { h, a, b } = await devPair();
    await h.reload(b);
    await b.session.join(CODE, { keepTrying: true });
    await h.run(1);
    expect(connected(b)).toBe(true);
    expect(a.session.players().map((p) => p.peerId)).toEqual(['dev-A', 'dev-B']);
    expect(a.notices).toContain('B is back');
    expect(sees(a, b) && sees(b, a)).toBe(true);
  });

  it('clients get back quickly when the host reloads', async () => {
    const { h, a, b } = await devPair();
    await h.reload(a);
    await h.run(0.2);
    expect(b.session.status.kind).toBe('reconnecting');
    await a.session.host(CODE);
    let back = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 3; t += 0.05) {
      await h.run(0.05);
      if (connected(b)) {
        back = t;
        break;
      }
    }
    // Backoff starts at 0.1 s, so a quick host reload costs well under a second.
    expect(back).toBeLessThan(0.6);
    await h.run(0.5);
    expect(b.notices.some((n) => n.startsWith('Back in'))).toBe(true);
    expect(sees(a, b) && sees(b, a)).toBe(true);
  });

  it.each([
    ['host first', 'A'],
    ['client first', 'B'],
  ])('both reload (%s) and land back in one game', async (_label, first) => {
    const { h, a, b } = await devPair();
    await h.reload(a);
    await h.reload(b);
    const hostAgain = () => a.session.host(CODE);
    const joinAgain = () => b.session.join(CODE, { keepTrying: true });
    if (first === 'A') await hostAgain();
    else await joinAgain();
    await h.run(1.5);
    if (first === 'A') await joinAgain();
    else await hostAgain();
    await h.run(3);
    expect(connected(a) && connected(b)).toBe(true);
    expect(a.session.players()).toHaveLength(2);
    expect(sees(a, b) && sees(b, a)).toBe(true);
  });

  it('a client on a newer build waits for the host to reload, then joins', async () => {
    const { h, a, b } = await devPair({ strictBuild: true });
    // The client has reloaded onto new code; the host is still on the old.
    await h.reload(b, { buildId: 'new' });
    await b.session.join(CODE, { keepTrying: true });
    await h.run(2);
    expect(connected(b)).toBe(false);
    expect(b.notices.filter((n) => n === 'Waiting for the host to reload…')).toHaveLength(1);
    expect(a.session.players()).toHaveLength(1);
    await h.reload(a, { buildId: 'new' });
    await a.session.host(CODE);
    await h.run(3);
    expect(connected(b)).toBe(true);
    expect(sees(a, b) && sees(b, a)).toBe(true);
  });

  it('gives up with a clear message if the builds never match', async () => {
    const { h, b } = await devPair({ strictBuild: true });
    await h.reload(b, { buildId: 'new' });
    await b.session.join(CODE, { keepTrying: true });
    await h.run(25);
    expect(b.session.status).toEqual({ kind: 'offline', error: INCOMPATIBLE_MESSAGE });
  });

  it('builds may differ in production (strictBuild off)', async () => {
    const h = new Harness();
    const a = h.addPeer('A', { buildId: 'one' });
    const b = h.addPeer('B', { buildId: 'two' });
    await a.session.host(CODE);
    await b.session.join(CODE);
    await h.run(1);
    expect(connected(b)).toBe(true);
  });

  it("other clients see a reloaded client's boat again straight away", async () => {
    const { h, a, b } = await devPair();
    const c = h.addPeer('C', { peerId: 'dev-C', phase: 4 });
    await c.session.join(CODE, { keepTrying: true });
    // Long enough that B's sequence numbers are well past where a restart begins.
    await h.run(10);
    expect(sees(c, b)).toBe(true);
    // B's page dies without its connection closing, so nobody hears it leave;
    // its new session restarts sequence numbers from 1.
    await h.reload(b, { silent: true });
    await b.session.join(CODE, { keepTrying: true });
    await h.run(1);
    expect(sees(c, b) && sees(a, b) && sees(b, c)).toBe(true);
  });

  it('joining with keepTrying waits for a host that is still starting', async () => {
    const h = new Harness();
    const a = h.addPeer('A', { peerId: 'dev-A' });
    const b = h.addPeer('B', { peerId: 'dev-B' });
    await b.session.join(CODE, { keepTrying: true });
    await h.run(3);
    expect(b.session.status.kind).toBe('joining');
    // Backoff: 0.1, 0.2, 0.4, 0.8, 1.6 s, not one attempt per frame.
    expect(b.attempts).toBeGreaterThanOrEqual(4);
    expect(b.attempts).toBeLessThanOrEqual(7);
    await a.session.host(CODE);
    await h.run(2.5);
    expect(connected(b)).toBe(true);
    expect(b.notices.some((n) => n.startsWith('Joined'))).toBe(true);
  });

  it('joining with keepTrying gives up after the window if nobody hosts', async () => {
    const h = new Harness();
    const b = h.addPeer('B', { peerId: 'dev-B' });
    await b.session.join(CODE, { keepTrying: true });
    await h.run(25);
    expect(b.session.status).toEqual({ kind: 'offline', error: "Couldn't find the host's game." });
  });
});
