/**
 * Dev URL flags (§13.1), e.g. `?seed=123&debug=physics,water&fresh=1`.
 * Values are kept as strings; each system parses the flags it cares about.
 */
export interface DevFlags {
  /** Skip session restore for this boot. */
  fresh: boolean;
  instance: string;
  /** Everything else, kept in the session snapshot. */
  flags: Record<string, string>;
}

const CONTROL_FLAGS = new Set(['fresh', 'instance']);

export function parseDevFlags(
  search: string,
  defaults: { instance: string; fresh: boolean },
): DevFlags {
  const params = new URLSearchParams(search);
  const flags: Record<string, string> = {};
  for (const [k, v] of params) if (!CONTROL_FLAGS.has(k)) flags[k] = v;
  const fresh = params.has('fresh') ? params.get('fresh') !== '0' : defaults.fresh;
  return { fresh, instance: params.get('instance') ?? defaults.instance, flags };
}
