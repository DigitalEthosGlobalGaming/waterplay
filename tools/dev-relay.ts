/**
 * Dev relay (§13.4.2): a localhost WebSocket server that DevSocketTransport talks
 * to instead of PeerJS. Started by tools/dev-electron.ts; never ships.
 *
 * It knows sessions (one host plus clients, keyed by code) and routes binary
 * frames between their members. A peer id that connects again replaces its
 * old socket, which is how a reloaded instance comes back as itself.
 */
import type { AddressInfo } from 'node:net';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import {
  RELAY_CLOSE_REPLACED,
  RELAY_TARGET_ALL,
  RELAY_TARGET_HOST,
  type RelayEvent,
  type RelayRequest,
  readRelayFrame,
  writeRelayFrame,
} from '../src/adapters/transport/devsocket/relay-protocol.ts';
import { formatShareCode, normalizeShareCode } from '../src/core/net/share-code.ts';

export interface DevRelay {
  /** ws://127.0.0.1:<port> */
  readonly url: string;
  close(): Promise<void>;
}

interface Conn {
  id: string;
  ws: WebSocket;
  /** Code of the session this peer is in, if any. */
  code: string | null;
}

interface Session {
  host: Conn;
  clients: Map<string, Conn>;
}

export async function startDevRelay(
  opts: { port?: number; log?: (message: string) => void } = {},
): Promise<DevRelay> {
  const log = opts.log ?? (() => {});
  const conns = new Map<string, Conn>();
  const sessions = new Map<string, Session>();
  const wss = new WebSocketServer({ host: '127.0.0.1', port: opts.port ?? 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  wss.on('connection', (ws, req) => {
    const id = new URL(req.url ?? '/', 'ws://relay').searchParams.get('peer');
    if (!id) {
      ws.close(4000, 'missing ?peer=');
      return;
    }
    // A reload: the new page's socket takes over from the old one.
    const old = conns.get(id);
    if (old) {
      leave(old);
      old.ws.close(RELAY_CLOSE_REPLACED, 'replaced');
    }
    const conn: Conn = { id, ws, code: null };
    conns.set(id, conn);

    ws.on('message', (data, isBinary) => {
      if (conns.get(id) !== conn) return;
      if (isBinary) route(conn, toBytes(data));
      else control(conn, data.toString());
    });
    ws.on('close', () => {
      if (conns.get(id) !== conn) return;
      conns.delete(id);
      leave(conn);
    });
  });

  function control(conn: Conn, text: string): void {
    let req: RelayRequest;
    try {
      req = JSON.parse(text) as RelayRequest;
    } catch {
      return;
    }
    const code = normalizeShareCode(req.code ?? '');
    if (!code) {
      send(conn, { op: 'error', message: `"${req.code}" isn't a game code.` });
      return;
    }
    leave(conn);
    const session = sessions.get(code);
    if (req.op === 'host') {
      if (session) {
        send(conn, {
          op: 'error',
          message: `${session.host.id} is already hosting ${formatShareCode(code)}.`,
        });
        return;
      }
      sessions.set(code, { host: conn, clients: new Map() });
      conn.code = code;
      send(conn, { op: 'hosted', code });
      log(`${conn.id} hosting ${formatShareCode(code)}`);
      return;
    }
    if (!session) {
      send(conn, { op: 'error', message: `No game found for code ${formatShareCode(code)}.` });
      return;
    }
    session.clients.set(conn.id, conn);
    conn.code = code;
    send(conn, { op: 'joined', host: session.host.id });
    send(session.host, { op: 'peerJoined', peer: conn.id });
    log(`${conn.id} joined ${session.host.id}`);
  }

  function route(from: Conn, bytes: Uint8Array): void {
    const session = from.code ? sessions.get(from.code) : undefined;
    const frame = readRelayFrame(bytes);
    if (!session || !frame) return;
    const out = writeRelayFrame(from.id, frame.channel, frame.payload);
    const members = [session.host, ...session.clients.values()];
    for (const to of members) {
      if (to === from) continue;
      const wanted =
        frame.peer === RELAY_TARGET_ALL ||
        frame.peer === to.id ||
        (frame.peer === RELAY_TARGET_HOST && to === session.host);
      if (wanted && to.ws.readyState === to.ws.OPEN) to.ws.send(out);
    }
  }

  /** Take a peer out of its session, telling whoever needs to know. */
  function leave(conn: Conn): void {
    const code = conn.code;
    conn.code = null;
    const session = code ? sessions.get(code) : undefined;
    if (!code || !session) return;
    if (session.host === conn) {
      sessions.delete(code);
      for (const c of session.clients.values()) {
        c.code = null;
        send(c, { op: 'hostLeft' });
      }
      log(`${conn.id} stopped hosting ${formatShareCode(code)}`);
    } else if (session.clients.delete(conn.id)) {
      send(session.host, { op: 'peerLeft', peer: conn.id });
      log(`${conn.id} left ${session.host.id}`);
    }
  }

  const { port } = wss.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of conns.values()) c.ws.terminate();
        wss.close(() => resolve());
      }),
  };
}

function send(conn: Conn, ev: RelayEvent): void {
  if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(ev));
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
