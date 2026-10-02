import type { NetStatus } from '../core/net/net-session.ts';
import { formatShareCode } from '../core/net/share-code.ts';

const NOTICE_SECONDS = 4;

/** Connection pill (top left) and short notices like "Ana joined" (§12.3). */
export class NetStatusView {
  private readonly pill = document.createElement('div');
  private readonly notices = document.createElement('div');
  private shown = '';

  constructor(root: HTMLElement) {
    this.pill.className = 'net-pill';
    this.pill.hidden = true;
    this.notices.className = 'net-notices';
    root.append(this.pill, this.notices);
  }

  update(status: NetStatus, playerCount: number): void {
    const text = pillText(status, playerCount);
    if (text === this.shown) return;
    this.shown = text;
    this.pill.hidden = text === '';
    this.pill.textContent = text;
    this.pill.dataset.kind = status.kind;
  }

  notice(text: string): void {
    const el = document.createElement('div');
    el.className = 'net-notice';
    el.textContent = text;
    this.notices.append(el);
    setTimeout(() => el.remove(), NOTICE_SECONDS * 1000);
  }

  dispose(): void {
    this.pill.remove();
    this.notices.remove();
  }
}

function pillText(s: NetStatus, count: number): string {
  const aboard = `${count} aboard`;
  switch (s.kind) {
    case 'offline':
      return s.error ? `Offline · ${s.error}` : '';
    case 'starting':
      return 'Starting game…';
    case 'hosting':
      return `Hosting · ${formatShareCode(s.code)} · ${aboard}`;
    case 'joining':
      return `Joining ${formatShareCode(s.code)}…`;
    case 'connected':
      return `Online · ${formatShareCode(s.code)} · ${aboard}`;
    case 'reconnecting':
      return 'Reconnecting…';
  }
}
