/**
 * Dev orchestrator (§13.4.2): Vite + esbuild watchers for main/preload + N Electron
 * instances, with coordinated save-and-restart when main/preload change.
 *
 *   tsx tools/dev-electron.ts --instances=2 [--fresh] [--sessions-dir=path]
 *
 * With more than one instance it also starts the dev relay (tools/dev-relay.ts):
 * instance A hosts and the others join it over localhost, reconnecting by
 * themselves after every reload or restart (§13.4.5). A single instance plays
 * online through PeerJS like the shipped game.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { context, type Plugin } from 'esbuild';
import { createServer } from 'vite';
import { ORCHESTRATOR } from '../apps/desktop/protocol.ts';
import { startDevRelay } from './dev-relay.ts';
import { electronBuildOptions } from './electron-esbuild.ts';

const SAVE_TIMEOUT_MS = 1000;
const CLIENT_LAUNCH_DELAY_MS = 300;

const argv = process.argv.slice(2);
const instanceCount = Math.max(1, Number(flag('instances') ?? 1));
const freshOnFirstLaunch = argv.includes('--fresh');
// --sessions-dir= keeps a test run from touching your own .dev-sessions.
const sessionsDir = resolve(flag('sessions-dir') ?? '.dev-sessions');
// require('electron') from Node returns the path to the Electron binary.
const electronBin = createRequire(import.meta.url)('electron') as string;

const COLOURS = ['\x1b[36m', '\x1b[35m', '\x1b[33m', '\x1b[32m'];
const RESET = '\x1b[0m';

interface Instance {
  id: string;
  slot: number;
  role: 'host' | 'client';
  proc: ChildProcess | null;
  pendingSave: (() => void) | null;
}

const instances: Instance[] = Array.from({ length: instanceCount }, (_, slot) => ({
  id: String.fromCharCode(65 + slot),
  slot,
  role: slot === 0 ? 'host' : 'client',
  proc: null,
  pendingSave: null,
}));

let restarting = false;
let shuttingDown = false;

// 1. Vite dev server for the renderer.
// Own port range so `npm run dev` (5173) and Electron dev can run side by side.
const vite = await createServer({
  configFile: resolve('vite.config.ts'),
  server: { port: 5180, strictPort: false },
});
await vite.listen();
const devServerUrl = vite.resolvedUrls?.local[0];
if (!devServerUrl) throw new Error('Vite did not report a local URL');
log('dev', `Vite ready at ${devServerUrl}`);

// 2. Dev relay, so instances connect to each other without PeerJS or share codes.
const relay = instanceCount > 1 ? await startDevRelay({ log: (m) => log('relay', m) }) : null;
if (relay) log('relay', `listening on ${relay.url}`);

// 3. esbuild watchers for main + preload; first build launches, later builds restart.
let firstBuild = true;
const onRebuild: Plugin = {
  name: 'waterplay-restart',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) {
        log('dev', 'main/preload build failed; keeping current instances running');
        return;
      }
      if (firstBuild) {
        firstBuild = false;
        await launchAll(freshOnFirstLaunch);
      } else {
        log('dev', 'main/preload changed → save, restart, restore');
        await restartAll();
      }
    });
  },
};
const esb = await context({ ...electronBuildOptions(true), plugins: [onRebuild] });
await esb.watch();

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

async function launchAll(fresh: boolean): Promise<void> {
  // Host first so clients have someone to connect to (§13.4.5).
  for (const inst of instances) {
    if (inst.role === 'client') await delay(CLIENT_LAUNCH_DELAY_MS);
    launch(inst, fresh);
  }
}

function launch(inst: Instance, fresh: boolean): void {
  const args = [
    '.',
    `--dev-server-url=${devServerUrl}`,
    `--dev-instance=${inst.id}`,
    `--dev-role=${inst.role}`,
    `--dev-slot=${inst.slot}`,
    `--dev-slots=${instanceCount}`,
    `--dev-sessions-dir=${sessionsDir}`,
    ...(relay ? [`--dev-relay-url=${relay.url}`] : []),
    ...(fresh ? ['--fresh'] : []),
  ];
  const proc = spawn(electronBin, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  inst.proc = proc;

  proc.on('message', (msg) => {
    if (msg === ORCHESTRATOR.savedMessage) inst.pendingSave?.();
  });
  const onLine = (line: string) => log(inst.id, line);
  if (proc.stdout) createInterface({ input: proc.stdout }).on('line', onLine);
  if (proc.stderr) createInterface({ input: proc.stderr }).on('line', onLine);

  proc.on('exit', (code) => {
    if (inst.proc !== proc) return;
    inst.proc = null;
    if (restarting || shuttingDown) return;
    log(inst.id, `exited (${code ?? 'signal'})`);
    // Closing every window ends the dev session.
    if (instances.every((i) => i.proc === null)) void shutdown();
  });
}

async function restartAll(): Promise<void> {
  if (restarting) return;
  restarting = true;
  try {
    await Promise.all(instances.map(requestSave));
    await Promise.all(instances.map(kill));
    await launchAll(false);
  } finally {
    restarting = false;
  }
}

/** Ask an instance to write its snapshot; resolve on ack or after a timeout. */
function requestSave(inst: Instance): Promise<void> {
  const proc = inst.proc;
  if (!proc?.connected) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(() => {
      log(inst.id, 'save-now timed out; relying on the 2s safety save');
      finish();
    }, SAVE_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      inst.pendingSave = null;
      done();
    };
    inst.pendingSave = finish;
    proc.send(ORCHESTRATOR.saveNowMessage);
  });
}

function kill(inst: Instance): Promise<void> {
  const proc = inst.proc;
  if (!proc || proc.exitCode !== null) return Promise.resolve();
  return new Promise((done) => {
    proc.once('exit', () => done());
    proc.kill();
  });
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all(instances.map(requestSave));
  await Promise.all(instances.map(kill));
  await esb.dispose();
  await relay?.close();
  await vite.close();
  process.exit(0);
}

function log(source: string, message: string): void {
  const idx = source.charCodeAt(0) - 65;
  const colour = source.length === 1 ? (COLOURS[idx % COLOURS.length] ?? '') : '\x1b[90m';
  console.log(`${colour}[${source}]${RESET} ${message}`);
}

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
