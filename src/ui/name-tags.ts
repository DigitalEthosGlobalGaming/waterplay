export interface NameTag {
  key: string;
  name: string;
  /** Screen position in CSS pixels, or null when off screen / behind the camera. */
  screen: { x: number; y: number; distance: number } | null;
}

/** Hidden beyond this distance (m); fades from FADE_START. */
const MAX_DISTANCE = 400;
const FADE_START = 250;

/** Floating names over other players' boats. DOM, positioned each frame. */
export class NameTags {
  private readonly el = document.createElement('div');
  private readonly tags = new Map<string, HTMLDivElement>();

  constructor(root: HTMLElement) {
    this.el.className = 'name-tags';
    root.append(this.el);
  }

  update(list: NameTag[]): void {
    const seen = new Set<string>();
    for (const t of list) {
      seen.add(t.key);
      let tag = this.tags.get(t.key);
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'name-tag';
        this.tags.set(t.key, tag);
        this.el.append(tag);
      }
      if (tag.textContent !== t.name) tag.textContent = t.name;
      const s = t.screen;
      if (!s || s.distance > MAX_DISTANCE) {
        tag.hidden = true;
        continue;
      }
      tag.hidden = false;
      tag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      const fade = 1 - Math.max(0, (s.distance - FADE_START) / (MAX_DISTANCE - FADE_START));
      tag.style.opacity = String(fade);
    }
    for (const [key, tag] of this.tags) {
      if (seen.has(key)) continue;
      tag.remove();
      this.tags.delete(key);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
