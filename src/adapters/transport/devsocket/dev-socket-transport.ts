import type { Unsubscribe } from '../../../core/interfaces/common.ts';
import type {
  Channel,
  ConnectionState,
  PeerId,
  Transport,
} from '../../../core/interfaces/transport.ts';
import { formatShareCode, normalizeShareCode } from '../../../core/net/share-code.ts';
import {
  DEV_SESSION_CODE,
  RELAY_TARGET_ALL,
  RELAY_TARGET_HOST,
  type RelayEvent,
  type RelayRequest,
  readRelayFrame,
  writeRelayFrame,
} from './relay-protocol.ts';

const OPEN_TIMEOUT_MS = 3000;
const REPLY_TIMEOUT_MS = 3000;

type Reply = Extract<RelayEvent, { op: 'hosted' | 'joined' | 'error' }>;

/**
 * Transport over the localhost dev relay (§13.4.2). Dev only, imported behind
 * `import.meta.env.DEV`. Same star semantics as PeerJsTransport, but the relay
 * routes every message itself, and peer ids are fixed per dev instance
 * (`dev-A`), so a reloaded instance comes back as the same peer.
 */
export class DevSocketTransport implements Transport {
  private socket: WebSocket | null = null;
  private hosting = false;
  private hostPeer: PeerId | null = null;
  private state: ConnectionState = 'disconnected';
  private pendingReply: ((r: Reply) => void) | null = null;

  private readonly messageCbs = new Set<(from: PeerId, ch: Channel, d: Uint8Array) => void>();
  private readonly joinedCbs = new Set<(p: PeerId) => void>();
  private readonly leftCbs = new Set<(p: PeerId) => void>();
  private readonly stateCbs = new Set<(s: ConnectionState) => void>();

  constructor(
    private readonly relayUrl: string,
    readonly localId: PeerId,
  ) {}

  get isHost(): boolean {
    return this.hosting;
  }

  async host(preferredCode?: string): Promise<{ shareCode: string }> {
    const code = normalizeShareCode(preferredCode ?? '') ?? DEV_SESSION_CODE;
    const reply = await this.request({ op: 'host', code });
    if (reply.op !== 'hosted') throw this.failed(reply);
    this.hosting = true;
    this.setState('connected');
    return { shareCode: reply.code };
  }

  async join(input: string): Promise<void> {
    const code = normalizeShareCode(input);
    if (!code) throw new Error(`"${input}" isn't a game code. Codes look like K7M-Q4X.`);
    this.setState('connecting');
    const reply = await this.request({ op: 'join', code }).catch((e: unknown) => {
      this.shutdown();
      throw e;
    });
    if (reply.op !== 'joined') throw this.failed(reply);
    this.hostPeer = reply.host as PeerId;
    this.setState('connected');
    for (const cb of this.joinedCbs) cb(this.hostPeer);
  }

  async leave(): Promise<void> {
    this.shutdown();
  }

  send(to: PeerId | 'all' | 'host', channel: Channel, data: Uint8Array): void {
    const ws = this.socket;
    if (this.state !== 'connected' || ws?.readyState !== WebSocket.OPEN) return;
    const target =
      to === 'all'
        ? RELAY_TARGET_ALL
        : to === 'host' || (!this.hosting && to === this.hostPeer)
          ? RELAY_TARGET_HOST
          : to;
    ws.send(writeRelayFrame(target, channel, data));
  }

  onMessage(cb: (from: PeerId, channel: Channel, data: Uint8Array) => void): Unsubscribe {
    return subscribe(this.messageCbs, cb);
  }

  onPeerJoined(cb: (peer: PeerId) => void): Unsubscribe {
    return subscribe(this.joinedCbs, cb);
  }

  onPeerLeft(cb: (peer: PeerId) => void): Unsubscribe {
    return subscribe(this.leftCbs, cb);
  }

  onConnectionStateChanged(cb: (s: ConnectionState) => void): Unsubscribe {
    return subscribe(this.stateCbs, cb);
  }

  // --- Internals ---------------------------------------------------------------

  /** Open the socket and send one request; resolves with the relay's answer. */
  private async request(req: RelayRequest): Promise<Reply> {
    if (this.socket) throw new Error('DevSocketTransport: already in a session; create a new one');
    const ws = await this.open();
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReply = null;
        this.shutdown();
        reject(new Error("The dev relay didn't answer."));
      }, REPLY_TIMEOUT_MS);
      this.pendingReply = (r) => {
        clearTimeout(timer);
        this.pendingReply = null;
        resolve(r);
      };
      ws.send(JSON.stringify(req));
    });
  }

  private open(): Promise<WebSocket> {
    const url = new URL(this.relayUrl);
    url.searchParams.set('peer', this.localId);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.socket = ws;
    return new Promise((resolve, reject) => {
      const fail = () => {
        clearTimeout(timer);
        this.shutdown();
        reject(
          new Error(`Can't reach the dev relay at ${this.relayUrl}. Is npm run dev:duo running?`),
        );
      };
      const timer = setTimeout(fail, OPEN_TIMEOUT_MS);
      ws.onerror = fail;
      ws.onopen = () => {
        clearTimeout(timer);
        ws.onerror = null;
        ws.onmessage = (e) => this.receive(e.data);
        ws.onclose = () => {
          if (this.socket === ws) this.shutdown();
        };
        resolve(ws);
      };
    });
  }

  private receive(data: unknown): void {
    if (typeof data === 'string') {
      let ev: RelayEvent;
      try {
        ev = JSON.parse(data) as RelayEvent;
      } catch {
        return;
      }
      this.event(ev);
      return;
    }
    if (!(data instanceof ArrayBuffer) || this.state !== 'connected') return;
    const frame = readRelayFrame(new Uint8Array(data));
    if (!frame) return;
    for (const cb of this.messageCbs) cb(frame.peer as PeerId, frame.channel, frame.payload);
  }

  private event(ev: RelayEvent): void {
    switch (ev.op) {
      case 'hosted':
      case 'joined':
      case 'error':
        this.pendingReply?.(ev);
        return;
      case 'peerJoined':
        for (const cb of this.joinedCbs) cb(ev.peer as PeerId);
        return;
      case 'peerLeft':
        for (const cb of this.leftCbs) cb(ev.peer as PeerId);
        return;
      case 'hostLeft':
        this.shutdown();
        return;
    }
  }

  private failed(reply: Reply): Error {
    this.shutdown();
    return new Error(
      reply.op === 'error'
        ? reply.message
        : `Unexpected answer from the dev relay (${formatShareCode(DEV_SESSION_CODE)})`,
    );
  }

  private shutdown(): void {
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
    const wasConnected = this.state === 'connected';
    const host = this.hostPeer;
    this.hostPeer = null;
    this.setState('disconnected');
    if (!this.hosting && host && wasConnected) for (const cb of this.leftCbs) cb(host);
    this.hosting = false;
  }

  private setState(s: ConnectionState): void {
    if (s === this.state) return;
    this.state = s;
    for (const cb of this.stateCbs) cb(s);
  }
}

function subscribe<T>(set: Set<T>, cb: T): Unsubscribe {
  set.add(cb);
  return () => set.delete(cb);
}
