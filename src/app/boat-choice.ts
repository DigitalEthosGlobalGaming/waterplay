import { type BoatTypeId, boatTypeOr } from '../data/boats.ts';

const KEY = 'waterplay.boatType';

/** The boat this player last picked, used when they spawn without a saved session. */
export function loadBoatChoice(): BoatTypeId {
  try {
    return boatTypeOr(localStorage.getItem(KEY));
  } catch {
    return boatTypeOr(null);
  }
}

export function saveBoatChoice(type: BoatTypeId): void {
  try {
    localStorage.setItem(KEY, type);
  } catch {
    // Private mode: the choice just won't stick.
  }
}
