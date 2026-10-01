import type { Rng } from '../sim/rng.ts';

/** No 0/O or 1/I/L, so codes survive being read aloud or copied from a screenshot (§5.2). */
export const SHARE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const SHARE_CODE_LENGTH = 6;

export function generateShareCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) code += rng.pick(SHARE_CODE_ALPHABET);
  return code;
}

/** `K7MQ4X` → `K7M-Q4X` */
export function formatShareCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** Accepts user input like ` k7m-q4x ` and returns `K7MQ4X`, or null if it isn't a valid code. */
export function normalizeShareCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== SHARE_CODE_LENGTH) return null;
  for (const c of cleaned) if (!SHARE_CODE_ALPHABET.includes(c)) return null;
  return cleaned;
}
