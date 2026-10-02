import type { Game } from '../app/game.ts';
import { restingBoatState } from '../core/boats/boat.ts';
import type { EntityId } from '../core/interfaces/common.ts';
import { headingOf, quatFromYaw, rotate } from '../core/math/vec.ts';
import { BOAT_TYPE_IDS } from '../data/boats.ts';

export interface DummyBoats {
  spawn(): void;
  clear(): void;
}

/** How the dummy drives: a big lazy loop, fast enough to throw a proper wake. */
const DUMMY_CONTROLS = { throttle: 0.9, steer: 0.25, boost: false };

/**
 * AI dummy boats for testing wakes solo (§M2). Dev only. They loop in wide
 * circles near where they spawn, are simulated (and broadcast) like any boat
 * this instance owns, and are left out of the session snapshot.
 */
export function installDummyBoats(game: Game): DummyBoats {
  const dummies = new Set<EntityId>();
  let spawned = 0;

  game.frameHooks.add(() => {
    for (const id of dummies) {
      const boat = game.sim.getBoat(id);
      if (boat) boat.controls = { ...DUMMY_CONTROLS };
      else dummies.delete(id);
    }
  });

  return {
    spawn: () => {
      const player = game.sim.getBoat(game.localBoatId)?.state();
      const at = player?.position ?? { x: 0, y: 0, z: 0 };
      const heading = player ? headingOf(player.rotation) : 0;
      // 30 m ahead and off to the side, heading across the player's bow.
      const rotation = quatFromYaw(heading);
      const offset = rotate(rotation, { x: -15 * (dummies.size + 1), y: 0, z: 30 });
      const id = game.nextEntityId();
      // Each dummy is the next boat in the lineup, so every wake size gets a look.
      const type = BOAT_TYPE_IDS[spawned++ % BOAT_TYPE_IDS.length] ?? 'speedboat';
      game.sim.addBoat(
        restingBoatState(
          id,
          type,
          at.x + offset.x,
          at.z + offset.z,
          quatFromYaw(heading + Math.PI / 2),
        ),
      );
      dummies.add(id);
      game.transientBoats.add(id);
    },
    clear: () => {
      for (const id of dummies) {
        game.sim.removeBoat(id);
        game.transientBoats.delete(id);
      }
      dummies.clear();
    },
  };
}
