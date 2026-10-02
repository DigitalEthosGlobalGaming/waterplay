import GUI, { type Controller } from 'lil-gui';
import type { Game } from '../app/game.ts';
import { BOAT_TYPE_IDS, boatTypes } from '../data/boats.ts';
import { cameraTunables } from '../data/camera.ts';
import { onTunablesChanged, resetTunableOverrides, setTunableOverride } from '../data/registry.ts';
import { cloudTunables, skyTunables } from '../data/sky.ts';
import { checkTunable } from '../data/tuning-limits.ts';
import { wakeParams, waterLook, waterParams } from '../data/water.ts';
import { type Debounced, debounce } from './debounce.ts';
import type { DevSessionControls } from './dev-session.ts';
import { installDummyBoats } from './dummy-boats.ts';

/** Edits apply once the value has settled, so typing "1200" never applies 1, 12, 120 on the way. */
const EDIT_DEBOUNCE_MS = 250;

/** One editable leaf. The controller edits `holder`; the live tunable changes only on commit. */
interface Field {
  holder: { value: unknown };
  controller: Controller;
  read: () => unknown;
  commit: Debounced<unknown>;
}

/** Slider ranges by property name; anything else gets a plain number box. */
const RANGES: Record<string, [min: number, max: number, step?: number]> = {
  amplitudeScale: [0, 3, 0.01],
  directionDeg: [-180, 180, 1],
  wavelength: [2, 200, 0.5],
  amplitude: [0, 3, 0.01],
  sharpness: [0, 1, 0.01],
  speedScale: [0, 3, 0.01],
  throttleResponse: [0.05, 5, 0.05],
  reverseThrustRatio: [0, 1, 0.05],
  boostThrustMultiplier: [1, 3, 0.05],
  fresnel: [0, 1, 0.01],
  specular: [0, 3, 0.01],
  shininess: [1, 300, 1],
  diffuse: [0, 2, 0.01],
  foamStart: [-0.5, 1, 0.01],
  foamEnd: [-0.5, 1.2, 0.01],
  reflection: [0, 1.5, 0.01],
  scatter: [0, 2, 0.01],
  jitter: [0, 0.95, 0.01],
  timeOffset: [0, 1, 0.001],
  sunTilt: [0, 1.4, 0.01],
  starDensity: [0, 3, 0.01],
  lightIntensity: [0, 4, 0.01],
  ambientIntensity: [0, 3, 0.01],
  count: [0, 128, 1],
  defaultPitch: [0, 1.3, 0.01],
  fov: [30, 100, 1],
  fovBoost: [0, 30, 0.5],
};

/**
 * Dev-only live tuning (§7.2, §13.4.6). Edits are debounced, validated against
 * data/tuning-limits.ts, then applied through the registry as overrides, so they
 * survive reloads via the session snapshot until the values are pasted back
 * into src/data ("Copy as TS").
 */
export function installTuningGui(game: Game, session: DevSessionControls): GUI {
  const gui = new GUI({ title: 'Tuning' });
  gui.close();

  const telemetry = { speedKnots: 0, forwardMs: 0, submerged: 0, throttle: 0, propInWater: false };
  const tele = gui.addFolder('Telemetry');
  tele.add(telemetry, 'speedKnots').decimals(1).listen().disable();
  tele.add(telemetry, 'forwardMs').decimals(2).listen().disable();
  tele.add(telemetry, 'throttle').decimals(2).listen().disable();
  tele.add(telemetry, 'submerged').decimals(2).listen().disable();
  tele.add(telemetry, 'propInWater').listen().disable();
  game.frameHooks.add(() => {
    const boat = game.sim.getBoat(game.localBoatId);
    if (!boat) return;
    telemetry.speedKnots = boat.telemetry.speed * 1.943844;
    telemetry.forwardMs = boat.telemetry.forwardSpeed;
    telemetry.submerged = boat.telemetry.submerged;
    telemetry.throttle = boat.throttle;
    telemetry.propInWater = boat.telemetry.propellerInWater;
  });

  const fields: Field[] = [];
  for (const id of BOAT_TYPE_IDS) {
    const type = boatTypes[id];
    section(gui, fields, `Boat: ${type.name}`, 'boats', type.handling, [id, 'handling']);
  }
  section(gui, fields, 'Waves', 'water', waterParams, []);
  section(gui, fields, 'Water look', 'waterLook', waterLook, []);
  const wakes = section(gui, fields, 'Wakes', 'wakes', wakeParams, []);
  const dummies = installDummyBoats(game);
  wakes.add({ spawn: () => dummies.spawn() }, 'spawn').name('Spawn AI dummy boat');
  wakes.add({ clear: () => dummies.clear() }, 'clear').name('Remove dummy boats');
  section(gui, fields, 'Camera', 'camera', cameraTunables, []);
  section(gui, fields, 'Sky & day cycle', 'sky', skyTunables, []);
  section(gui, fields, 'Clouds', 'clouds', cloudTunables, []);

  // Show values changed elsewhere (data file hot swap, reset), except fields mid-edit.
  const refresh = () => {
    for (const f of fields) {
      if (f.commit.pending) continue;
      const live = f.read();
      if (live === f.holder.value) continue;
      f.holder.value = live;
      f.controller.updateDisplay();
    }
  };
  onTunablesChanged(refresh);
  game.frameHooks.add(refresh);

  gui
    .add(
      {
        resetOverrides: () => {
          resetTunableOverrides();
          console.info('[tuning] overrides cleared; values are back to src/data');
        },
      },
      'resetOverrides',
    )
    .name('Reset all to src/data');
  gui
    .add({ resetGame: () => session.resetGame() }, 'resetGame')
    .name('Reset game (clear saved session)');
  return gui;
}

function section(
  gui: GUI,
  fields: Field[],
  title: string,
  key: string,
  obj: object,
  basePath: string[],
): GUI {
  const folder = gui.addFolder(title).close();
  addFields(folder, fields, key, obj, basePath);
  folder
    .add(
      {
        copy: () => {
          const text = JSON.stringify(obj, null, 2);
          void navigator.clipboard?.writeText(text).catch(() => undefined);
          console.info(`[tuning] ${key} ${basePath.join('.')}\n${text}`);
        },
      },
      'copy',
    )
    .name('Copy as TS');
  return folder;
}

function addFields(folder: GUI, fields: Field[], key: string, obj: object, path: string[]): void {
  const record = obj as Record<string, unknown>;
  for (const [prop, value] of Object.entries(record)) {
    const p = [...path, prop];
    if (typeof value === 'object' && value !== null) {
      addFields(folder.addFolder(prop).close(), fields, key, value, p);
      continue;
    }
    const holder = { value };
    let controller: Controller;
    if (typeof value === 'number') {
      const range = RANGES[prop];
      controller = range
        ? folder.add(holder, 'value', range[0], range[1], range[2])
        : folder.add(holder, 'value');
    } else if (typeof value === 'boolean') {
      controller = folder.add(holder, 'value');
    } else if (typeof value === 'string' && value.startsWith('#')) {
      controller = folder.addColor(holder, 'value');
    } else {
      continue;
    }
    controller.name(prop);

    const commit = debounce<unknown>(EDIT_DEBOUNCE_MS, (v) => {
      const problem = checkTunable(prop, v);
      if (problem) {
        console.warn(`[tuning] rejected ${key}:${p.join('.')} = ${String(v)}: ${problem}`);
        holder.value = record[prop];
        controller.updateDisplay();
        return;
      }
      setTunableOverride(key, p.join('.'), v);
    });
    controller.onChange((v: unknown) => commit(v));
    fields.push({ holder, controller, read: () => record[prop], commit });
  }
}
