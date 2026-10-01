import { describe, expect, it } from 'vitest';
import { LoopbackNetwork } from '../../src/adapters/transport/loopback/loopback-transport.ts';
import type { Channel, PeerId } from '../../src/core/interfaces/transport.ts';

const bytes = (...n: number[]) => new Uint8Array(n);

function inbox(t: { onMessage: (cb: (f: PeerId, c: Channel, d: Uint8Array) => void) => unknown }) {
  const got: Array<{ from: string; channel: Channel; data: number[] }> = [];
  t.onMessage((from, channel, data) => got.push({ from, channel, data: [...data] }));
  return got;
}

async function session(net: LoopbackNetwork, clients: number) {
  const host = net.createTransport('host');
  const { shareCode } = await host.host();
  const peers = [];
  for (let i = 0; i < clients; i++) {
    const c = net.createTransport(`c${i}`);
    await c.join(shareCode);
    peers.push(c);
  }
  net.flush();
  return { host, clients: peers, shareCode };
}

describe('LoopbackTransport', () => {
  it('host and client exchange messages', async () => {
    const net = new LoopbackNetwork();
    const { host, clients } = await session(net, 1);
    const [c] = clients;
    if (!c) throw new Error('no client');
    const hostIn = inbox(host);
    const clientIn = inbox(c);
    c.send('host', 'reliable', bytes(1, 2));
    host.send('all', 'unreliable', bytes(3));
    net.flush();
    expect(hostIn).toEqual([{ from: 'c0', channel: 'reliable', data: [1, 2] }]);
    expect(clientIn).toEqual([{ from: 'host', channel: 'unreliable', data: [3] }]);
  });

  it('fires join and leave events', async () => {
    const net = new LoopbackNetwork();
    const host = net.createTransport('host');
    const joined: string[] = [];
    const left: string[] = [];
    host.onPeerJoined((p) => joined.push(p));
    host.onPeerLeft((p) => left.push(p));
    const { shareCode } = await host.host();
    const c = net.createTransport('c0');
    await c.join(shareCode);
    net.flush();
    await c.leave();
    net.flush();
    expect(joined).toEqual(['c0']);
    expect(left).toEqual(['c0']);
  });

  it('accepts formatted codes and rejects unknown ones', async () => {
    const net = new LoopbackNetwork();
    const host = net.createTransport('host');
    const { shareCode } = await host.host();
    const formatted = `${shareCode.slice(0, 3).toLowerCase()}-${shareCode.slice(3)}`;
    await expect(net.createTransport('a').join(formatted)).resolves.toBeUndefined();
    await expect(net.createTransport('b').join('ZZZ-ZZZ')).rejects.toThrow(/No session/);
  });

  it('relays client→client via the host with two hops of latency', async () => {
    const net = new LoopbackNetwork({ conditions: { latencyMs: 50 } });
    const { host, clients } = await session(net, 2);
    const [a, b] = clients;
    if (!a || !b) throw new Error('missing clients');
    const hostIn = inbox(host);
    const bIn = inbox(b);
    const aIn = inbox(a);
    a.send('all', 'reliable', bytes(9));
    net.advance(50);
    expect(hostIn).toHaveLength(1);
    expect(bIn).toHaveLength(0);
    net.advance(50);
    expect(bIn).toEqual([{ from: 'c0', channel: 'reliable', data: [9] }]);
    expect(aIn).toHaveLength(0);
  });

  it('keeps reliable messages ordered under jitter', async () => {
    const net = new LoopbackNetwork({ conditions: { latencyMs: 20, jitterMs: 80 }, seed: 4 });
    const { host, clients } = await session(net, 1);
    const hostIn = inbox(host);
    for (let i = 0; i < 50; i++) clients[0]?.send('host', 'reliable', bytes(i));
    net.flush();
    expect(hostIn.map((m) => m.data[0])).toEqual([...Array(50).keys()]);
  });

  it('drops unreliable messages at the configured rate, never reliable ones', async () => {
    const net = new LoopbackNetwork({ conditions: { lossRate: 0.3 }, seed: 11 });
    const { host, clients } = await session(net, 1);
    const hostIn = inbox(host);
    for (let i = 0; i < 1000; i++) clients[0]?.send('host', 'unreliable', bytes(1));
    for (let i = 0; i < 100; i++) clients[0]?.send('host', 'reliable', bytes(2));
    net.flush();
    const unreliable = hostIn.filter((m) => m.channel === 'unreliable').length;
    expect(unreliable).toBeGreaterThan(600);
    expect(unreliable).toBeLessThan(800);
    expect(hostIn.filter((m) => m.channel === 'reliable')).toHaveLength(100);
  });

  it('clients are disconnected when the host drops', async () => {
    const net = new LoopbackNetwork();
    const { host, clients } = await session(net, 2);
    const states: string[] = [];
    clients[0]?.onConnectionStateChanged((s) => states.push(s));
    host.simulateDrop();
    net.flush();
    expect(states).toEqual(['disconnected']);
    expect(clients.every((c) => c.connectionState === 'disconnected')).toBe(true);
  });

  it('copies payloads so senders can reuse buffers', async () => {
    const net = new LoopbackNetwork({ conditions: { latencyMs: 10 } });
    const { host, clients } = await session(net, 1);
    const hostIn = inbox(host);
    const buf = bytes(1);
    clients[0]?.send('host', 'reliable', buf);
    buf[0] = 99;
    net.flush();
    expect(hostIn[0]?.data).toEqual([1]);
  });
});
