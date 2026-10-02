import type { NetPlayer, NetStatus } from '../core/net/net-session.ts';
import { MAX_NAME_LENGTH } from '../core/net/protocol.ts';
import {
  formatShareCode,
  normalizeShareCode,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
} from '../core/net/share-code.ts';
import type { ActiveDevice, InputSnapshot } from '../input/actions.ts';
import { FocusManager, type NavDirection } from './focus-manager.ts';

/** What the menu needs from the multiplayer layer. */
export interface MenuNet {
  readonly name: string;
  readonly session: {
    readonly status: NetStatus;
    players(): NetPlayer[];
    onStatus(cb: (s: NetStatus) => void): () => void;
  };
  host(): Promise<void>;
  join(code: string): Promise<void>;
  leave(): Promise<void>;
  setName(name: string): void;
  copyInviteLink(): Promise<boolean>;
  inviteLink(): string | null;
}

type Screen = 'main' | 'join' | 'name';

const HINTS: Record<ActiveDevice, string> = {
  kbm: '<kbd>↑↓</kbd> Move · <kbd>Enter</kbd> Select · <kbd>Esc</kbd> Back',
  gamepad: '<kbd>D-pad</kbd> Move · <kbd>A</kbd> Select · <kbd>B</kbd> Back',
};

const PAD_CODE_HINT =
  '<kbd>↑↓</kbd> Letter · <kbd>←→</kbd> Move · <kbd>A</kbd> Join · <kbd>B</kbd> Back';

/**
 * Pause menu (Esc / Start): host, join, invite, leave and name (§8, §12).
 * Fully usable with a controller: the FocusManager drives it and the code
 * entry cycles characters with up/down.
 */
export class Menu {
  readonly el = document.createElement('div');
  private readonly panel = document.createElement('div');
  private readonly focus: FocusManager;
  private screen: Screen = 'main';
  private renderedScreen: Screen | null = null;
  private isOpen = false;
  private device: ActiveDevice = 'kbm';
  private flash = '';
  private codeSlot = 0;
  private codeDraft = '';

  constructor(
    root: HTMLElement,
    private readonly net: MenuNet,
    private readonly randomName: () => string,
  ) {
    this.el.className = 'menu';
    this.el.hidden = true;
    this.panel.className = 'menu-panel';
    this.el.append(this.panel);
    root.append(this.el);
    this.focus = new FocusManager(this.panel, (el, dir, input) => this.navCode(el, dir, input));
    // Clicking the dimmed backdrop resumes.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    net.session.onStatus(() => {
      if (this.isOpen) this.render();
    });
  }

  get open(): boolean {
    return this.isOpen;
  }

  /** Call every frame. Returns true while the menu has the controls. */
  update(input: InputSnapshot, frameSeconds: number): boolean {
    if (input.activeDevice !== this.device) {
      this.device = input.activeDevice;
      if (this.isOpen) this.render();
    }
    if (!this.isOpen) {
      if (input.pressed('pause')) this.show();
      return this.isOpen;
    }
    // Esc maps to both pause and uiBack: treat it as one "back".
    if (input.pressed('pause') && this.device === 'gamepad') this.close();
    else if (input.pressed('uiBack') || input.pressed('pause')) this.back();
    else this.focus.update(input, frameSeconds);
    return this.isOpen;
  }

  show(screen: Screen = 'main'): void {
    this.isOpen = true;
    this.el.hidden = false;
    this.screen = screen;
    this.flash = '';
    this.render();
  }

  close(): void {
    this.isOpen = false;
    this.renderedScreen = null;
    this.el.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur();
    document.querySelector<HTMLElement>('#game')?.focus();
  }

  private back(): void {
    if (this.screen === 'main') this.close();
    else this.go('main');
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.flash = '';
    if (screen === 'join') {
      this.codeDraft = '';
      this.codeSlot = 0;
    }
    this.render();
  }

  // --- Rendering ---------------------------------------------------------------

  private render(): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset.id;
    const p = this.panel;
    p.replaceChildren();
    const title = h('h1', { text: 'Waterplay' });
    p.append(title);

    if (this.screen === 'main') this.renderMain();
    else if (this.screen === 'join') this.renderJoin();
    else this.renderName();

    const hint = h('div', { cls: 'menu-hint' });
    hint.innerHTML =
      this.screen === 'join' && this.device === 'gamepad' ? PAD_CODE_HINT : HINTS[this.device];
    p.append(hint);

    // A new screen starts at its first item; a refresh of the same screen keeps focus.
    const sameScreen = this.renderedScreen === this.screen;
    this.renderedScreen = this.screen;
    const keep = sameScreen && focusedId;
    const prefer = keep
      ? p.querySelector<HTMLElement>(`[data-id="${focusedId}"]`)
      : p.querySelector<HTMLElement>('[data-focus]');
    this.focus.refresh(prefer);
  }

  private renderMain(): void {
    const s = this.net.session.status;
    const p = this.panel;
    p.append(h('div', { cls: 'menu-status', text: statusLine(s) }));
    if (s.kind === 'offline' && s.error) p.append(h('div', { cls: 'menu-error', text: s.error }));
    if (this.flash) p.append(h('div', { cls: 'menu-flash', text: this.flash }));

    p.append(button('resume', 'Resume', () => this.close()));

    if (s.kind === 'offline') {
      p.append(
        button('host', 'Host a game', () => void this.net.host()),
        button('join', 'Join a game', () => this.go('join')),
      );
    } else if (s.kind === 'hosting' || s.kind === 'connected') {
      p.append(players(this.net.session.players()));
      p.append(
        button('invite', 'Copy invite link', async () => {
          const ok = await this.net.copyInviteLink();
          this.flash = ok
            ? 'Invite link copied. Send it to a friend!'
            : `Share this link: ${this.net.inviteLink() ?? ''}`;
          this.render();
        }),
        button(
          'leave',
          s.kind === 'hosting' ? 'End game' : 'Leave game',
          () => void this.net.leave(),
        ),
      );
    } else {
      p.append(button('cancel', 'Cancel', () => void this.net.leave()));
    }

    p.append(button('name', `Name: ${this.net.name}`, () => this.go('name')));
  }

  private renderJoin(): void {
    const p = this.panel;
    p.append(h('div', { cls: 'menu-status', text: 'Enter the code your friend sees' }));
    if (this.flash) p.append(h('div', { cls: 'menu-error', text: this.flash }));

    const input = h('input', { cls: 'menu-code' }) as HTMLInputElement;
    input.dataset.focus = '';
    input.dataset.id = 'code';
    input.dataset.nav = 'code';
    input.placeholder = 'K7M-Q4X';
    input.maxLength = SHARE_CODE_LENGTH + 1;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = this.codeDraft;
    input.addEventListener('input', () => {
      const clean = input.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
      input.value = clean.length > 3 ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}` : clean;
      this.codeDraft = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitJoin();
    });
    // On a pad the D-pad edits the code, so A on the field joins straight away.
    input.addEventListener('click', () => {
      if (this.device === 'gamepad') this.submitJoin();
    });
    p.append(input);
    p.append(
      button('do-join', 'Join', () => this.submitJoin()),
      button('back', 'Back', () => this.go('main')),
    );
    if (this.device === 'gamepad') this.selectCodeSlot(input);
  }

  private renderName(): void {
    const p = this.panel;
    p.append(h('div', { cls: 'menu-status', text: 'What should other sailors call you?' }));
    const input = h('input', { cls: 'menu-name' }) as HTMLInputElement;
    input.dataset.focus = '';
    input.dataset.id = 'name-input';
    input.maxLength = MAX_NAME_LENGTH;
    input.value = this.net.name;
    const save = () => {
      this.net.setName(input.value);
      this.go('main');
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    p.append(
      input,
      button('random-name', 'Random name', () => {
        input.value = this.randomName();
      }),
      button('save-name', 'Save', save),
      button('back', 'Back', () => this.go('main')),
    );
  }

  private submitJoin(): void {
    const code = normalizeShareCode(this.codeDraft);
    if (!code) {
      this.flash = 'Codes are 6 letters and numbers, like K7M-Q4X.';
      this.render();
      return;
    }
    void this.net.join(code);
    this.go('main');
  }

  // --- Controller code entry ---------------------------------------------------

  /** Gamepad on the code field: left/right picks a slot, up/down cycles its character. */
  private navCode(el: HTMLElement, dir: NavDirection, input: InputSnapshot): boolean {
    if (el.dataset.nav !== 'code' || input.activeDevice !== 'gamepad') return false;
    const field = el as HTMLInputElement;
    const chars = (normalizeShareCode(this.codeDraft) ?? padCode(this.codeDraft)).split('');
    if (dir === 'left') this.codeSlot = Math.max(0, this.codeSlot - 1);
    else if (dir === 'right') this.codeSlot = Math.min(SHARE_CODE_LENGTH - 1, this.codeSlot + 1);
    else {
      const a = SHARE_CODE_ALPHABET;
      const at = Math.max(0, a.indexOf(chars[this.codeSlot] ?? a[0] ?? ''));
      chars[this.codeSlot] = a[(at + (dir === 'up' ? 1 : -1) + a.length) % a.length] ?? '';
    }
    this.codeDraft = formatShareCode(chars.join(''));
    field.value = this.codeDraft;
    this.selectCodeSlot(field);
    return true;
  }

  private selectCodeSlot(field: HTMLInputElement): void {
    if (!field.value) {
      this.codeDraft = formatShareCode(padCode(''));
      field.value = this.codeDraft;
    }
    // Skip over the dash after the third character.
    const pos = this.codeSlot < 3 ? this.codeSlot : this.codeSlot + 1;
    requestAnimationFrame(() => field.setSelectionRange(pos, pos + 1));
  }
}

function padCode(draft: string): string {
  const clean = draft.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const fill = SHARE_CODE_ALPHABET[0] ?? '2';
  return (clean + fill.repeat(SHARE_CODE_LENGTH)).slice(0, SHARE_CODE_LENGTH);
}

function statusLine(s: NetStatus): string {
  switch (s.kind) {
    case 'offline':
      return 'Sailing solo';
    case 'starting':
      return 'Starting a game…';
    case 'hosting':
      return `Hosting · code ${formatShareCode(s.code)}`;
    case 'joining':
      return `Joining ${formatShareCode(s.code)}…`;
    case 'connected':
      return `In a game · code ${formatShareCode(s.code)}`;
    case 'reconnecting':
      return 'Lost the host, reconnecting…';
  }
}

function players(list: NetPlayer[]): HTMLElement {
  const ul = h('ul', { cls: 'menu-players' });
  for (const p of list) {
    const li = h('li', { text: p.name });
    if (p.isHost) li.append(h('span', { cls: 'menu-tag', text: 'host' }));
    if (p.isLocal) li.append(h('span', { cls: 'menu-tag', text: 'you' }));
    ul.append(li);
  }
  return ul;
}

function button(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { text: label }) as HTMLButtonElement;
  b.type = 'button';
  b.dataset.focus = '';
  b.dataset.id = id;
  b.addEventListener('click', onClick);
  return b;
}

function h(tag: string, opts: { cls?: string; text?: string } = {}): HTMLElement {
  const el = document.createElement(tag);
  if (opts.cls) el.className = opts.cls;
  if (opts.text !== undefined) el.textContent = opts.text;
  return el;
}
