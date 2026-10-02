import { cleanName } from '../core/net/protocol.ts';

const KEY = 'waterplay.playerName';

const ADJECTIVES = (
  'Salty Sunny Breezy Drifty Speedy Sleepy Jolly Misty Plucky Bouncy ' +
  'Lucky Wavy Cosy Zippy Foamy Merry Brave Dizzy'
).split(' ');
const NOUNS = (
  'Otter Puffin Gull Seal Dolphin Crab Pelican Turtle Walrus Narwhal ' +
  'Heron Manatee Starfish Barnacle Squid Minnow Tern Cod'
).split(' ');

export function randomPlayerName(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)] ?? '';
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

/** The saved name, or a fresh fun one (saved so it sticks). */
export function loadPlayerName(): string {
  const saved = read();
  if (saved) return cleanName(saved);
  const name = randomPlayerName();
  savePlayerName(name);
  return name;
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(KEY, cleanName(name));
  } catch {
    // Private mode: the name just won't stick.
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
