import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevSocketTransport } from '../../src/adapters/transport/devsocket/dev-socket-transport.ts';
import { DEV_SESSION_CODE } from '../../src/adapters/transport/devsocket/relay-protocol.ts';
import type { Channel, PeerId } from '../../src/core/interfaces/transport.ts';
import { type DevRelay, startDevRelay } from '../../tools/dev-relay.ts';

/** The real relay and real WebSockets (Node's built-in client), on a random localhost port. */
let relay: DevRelay;
const open: DevSocketTransport[] = [];

beforeEach(async () => {
  relay = await startDevRelay();
});

afterEach(async () => {
  for (const t of open.splice(0)) await t.leave();
  await relay.close();
});

function transport(id: string): DevSocketTransport {
  const t = new DevSocketTransport(relay.url, id as PeerId);
  open.push(t);
  return t;
}

interface Inbox {
  messages: { from: string; channel: Channel; text: string }[];
  joined: string[];
  left: string[];
}

function inbox(t: DevSocketTransport): Inbox {
  const box: Inbox = { messages: [], joined: [], left: [] };
  t.onMessage((from, channel, data) =>
    box.messages.push({ from, channel, text: new TextDecoder().decode(data) }),
  );
  t.onPeerJoined((p) => box.joined.push(p));
  t.onPeerLeft((p) => box.left.push(p));
  return box;
}

const bytes = (s: string) => new TextEncoder().encode(s);

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('dev relay + DevSocketTransport', () => {
  it('hosts the dev code, joins, and routes to host, to everyone and to one peer', async () => {
    const a = transport('dev-A');
    const b = transport('dev-B');
    const c = transport('dev-C');
    const [ia, ib, ic] = [inbox(a), inbox(b), inbox(c)];
    expect(await a.host()).toEqual({ shareCode: DEV_SESSION_CODE });
    expect(a.isHost).toBe(true);
    await b.join('DEV-DEV');
    await c.join(DEV_SESSION_CODE);
    await until(() => ia.joined.length === 2);
    expect(ia.joined).toEqual(['dev-B', 'dev-C']);
    expect(ib.joined).toEqual(['dev-A']);

    b.send('host', 'reliable', bytes('to host'));
    c.send('all', 'unreliable', bytes('to all'));
    a.send('dev-B' as PeerId, 'reliable', bytes('just B'));
    b.send('dev-C' as PeerId, 'reliable', bytes('B to C'));
    await until(() => ia.messages.length === 2 && ib.messages.length === 2);
    await until(() => ic.messages.length === 1);
    expect(ia.messages).toEqual([
      { from: 'dev-B', channel: 'reliable', text: 'to host' },
      { from: 'dev-C', channel: 'unreliable', text: 'to all' },
    ]);
    expect(ib.messages.map((m) => `${m.from}:${m.text}`).sort()).toEqual([
      'dev-A:just B',
      'dev-C:to all',
    ]);
    expect(ic.messages).toEqual([{ from: 'dev-B', channel: 'reliable', text: 'B to C' }]);
  });

  it('a reloaded instance takes over its peer id; the host sees it leave and rejoin', async () => {
    const a = transport('dev-A');
    const b1 = transport('dev-B');
    const ia = inbox(a);
    const ib1 = inbox(b1);
    await a.host();
    await b1.join(DEV_SESSION_CODE);
    await until(() => ia.joined.length === 1);
    const b2 = transport('dev-B');
    await b2.join(DEV_SESSION_CODE);
    await until(() => ia.joined.length === 2 && ib1.left.length === 1);
    expect(ia.left).toEqual(['dev-B']);
    expect(ib1.left).toEqual(['dev-A']);
    b2.send('host', 'reliable', bytes('new page'));
    await until(() => ia.messages.length === 1);
    expect(ia.messages[0]?.text).toBe('new page');
  });

  it('clients hear the host leave', async () => {
    const a = transport('dev-A');
    const b = transport('dev-B');
    const ib = inbox(b);
    const states: string[] = [];
    b.onConnectionStateChanged((s) => states.push(s));
    await a.host();
    await b.join(DEV_SESSION_CODE);
    await a.leave();
    await until(() => ib.left.length === 1);
    expect(ib.left).toEqual(['dev-A']);
    expect(states.at(-1)).toBe('disconnected');
  });

  it('explains unknown codes and a missing relay', async () => {
    await expect(transport('dev-B').join('K7M-Q4X')).rejects.toThrow('No game found');
    const nowhere = new DevSocketTransport('ws://127.0.0.1:1', 'dev-Z' as PeerId);
    await expect(nowhere.host()).rejects.toThrow("Can't reach the dev relay");
  });
});
