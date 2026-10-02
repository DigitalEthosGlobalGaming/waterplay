import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, ipcMain } from 'electron';
import type { DesktopArgs } from './args.ts';
import { DEV_IPC, ORCHESTRATOR } from './protocol.ts';

/**
 * Dev-only main-process side of session persistence (§13.4.3) and the
 * orchestrator's save-now handshake (§13.4.5). Only referenced behind __DEV__.
 */
export function installDevIpc(
  args: DesktopArgs,
  isDev: boolean,
  getWindow: () => BrowserWindow | null,
): void {
  // Always answered so the preload's sendSync never waits on a missing handler.
  ipcMain.on(DEV_IPC.info, (e) => {
    e.returnValue = isDev
      ? { instance: args.instance, role: args.role, fresh: args.fresh, relayUrl: args.relayUrl }
      : null;
  });
  if (!isDev) return;

  const dir = args.sessionsDir ?? join(process.cwd(), '.dev-sessions');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${args.instance}.json`);

  ipcMain.on(DEV_IPC.load, (e) => {
    try {
      e.returnValue = readFileSync(file, 'utf8');
    } catch {
      e.returnValue = null;
    }
  });
  ipcMain.on(DEV_IPC.save, (e, json: string) => {
    // Write-then-rename so a crash mid-write never leaves a truncated snapshot.
    try {
      writeFileSync(`${file}.tmp`, json);
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error('[dev] failed to write session', err);
    }
    e.returnValue = true;
  });
  ipcMain.on(DEV_IPC.clear, (e) => {
    rmSync(file, { force: true });
    e.returnValue = true;
  });
  ipcMain.on(DEV_IPC.saveNowAck, () => {
    process.send?.(ORCHESTRATOR.savedMessage);
  });

  // The orchestrator talks to us over Node's IPC channel (stdin isn't delivered to
  // Electron's main process on Windows).
  process.on('message', (msg) => {
    if (msg !== ORCHESTRATOR.saveNowMessage) return;
    const win = getWindow();
    if (win) win.webContents.send(DEV_IPC.saveNow);
    else process.send?.(ORCHESTRATOR.savedMessage);
  });
}
