/**
 * Live tunables (§13.4.6, §14.14).
 *
 * Each data module wraps its exported object in `liveTunable(key, value)` and
 * self-accepts HMR. When the module is edited, Vite re-executes it; `liveTunable`
 * then copies the new values INTO the object created on first load and returns
 * that same object. Everything that imported the original keeps seeing current
 * values, as long as it reads fields at use time instead of caching them.
 *
 * Tuning overrides (lil-gui edits not yet pasted into src/data) are tracked here
 * by `key` + property path, so they can ride along in the session snapshot.
 */
const live = new Map<string, object>();
/** Values as written in the data file, for resetting overrides. */
const defaults = new Map<string, unknown>();
const listeners = new Set<(key: string) => void>();
/** `${key}:${path}` → value */
let overrides: Record<string, unknown> = {};

export function liveTunable<T extends object>(key: string, value: T): T {
  defaults.set(key, structuredClone(value));
  const existing = live.get(key) as T | undefined;
  if (!existing) {
    live.set(key, value);
    return value;
  }
  replaceContents(existing, value);
  // The data file was edited: it is now the source of truth for this key.
  for (const id of Object.keys(overrides)) if (id.startsWith(`${key}:`)) delete overrides[id];
  for (const cb of listeners) cb(key);
  return existing;
}

/** Called after a data module hot swaps. Most systems don't need this; they just read fields each tick. */
export function onTunablesChanged(cb: (key: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Set a tunable and remember it as an override. `path` is dot-separated, e.g. 'speedboat.handling.mass'. */
export function setTunableOverride(key: string, path: string, value: unknown): void {
  if (setPath(live.get(key), path, value)) overrides[`${key}:${path}`] = structuredClone(value);
}

export function getTunableOverrides(): Record<string, unknown> {
  return structuredClone(overrides);
}

/** Re-apply saved overrides. Unknown keys/paths are skipped; returns the ones that applied. */
export function applyTunableOverrides(saved: Record<string, unknown>): string[] {
  const applied: string[] = [];
  for (const [id, value] of Object.entries(saved)) {
    const sep = id.indexOf(':');
    if (sep < 0) continue;
    const key = id.slice(0, sep);
    const path = id.slice(sep + 1);
    if (setPath(live.get(key), path, value)) {
      overrides[id] = structuredClone(value);
      applied.push(id);
    }
  }
  return applied;
}

/** Drop every override and restore the values from the data files. */
export function resetTunableOverrides(): void {
  overrides = {};
  for (const [key, target] of live) {
    replaceContents(target, structuredClone(defaults.get(key)) as object);
    for (const cb of listeners) cb(key);
  }
}

function replaceContents(target: object, source: object): void {
  const t = target as Record<string, unknown>;
  for (const k of Object.keys(t)) if (!(k in source)) delete t[k];
  Object.assign(t, source);
}

/** Only overwrites an existing leaf of the same type, so stale snapshots can't add junk. */
function setPath(root: unknown, path: string, value: unknown): boolean {
  const parts = path.split('.');
  const leaf = parts.pop();
  if (leaf === undefined) return false;
  let node = root;
  for (const p of parts) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[p];
  }
  if (typeof node !== 'object' || node === null) return false;
  const obj = node as Record<string, unknown>;
  if (!(leaf in obj) || typeof obj[leaf] !== typeof value) return false;
  obj[leaf] = value;
  return true;
}
