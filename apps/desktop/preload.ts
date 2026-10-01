import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DevBridge } from '../../src/adapters/platform/desktop-bridge.ts';
import { DEV_IPC } from './protocol.ts';

declare const __DEV__: boolean;

const bridge: DesktopBridge = {};

if (__DEV__) {
  const info = ipcRenderer.sendSync(DEV_IPC.info) as Pick<
    DevBridge,
    'instance' | 'role' | 'fresh'
  > | null;
  // null when a dev build runs without the orchestrator.
  if (info) {
    bridge.dev = {
      ...info,
      loadSession: () => ipcRenderer.sendSync(DEV_IPC.load) as string | null,
      saveSession: (json) => {
        ipcRenderer.sendSync(DEV_IPC.save, json);
      },
      clearSession: () => {
        ipcRenderer.sendSync(DEV_IPC.clear);
      },
      onSaveNow: (cb) => {
        ipcRenderer.on(DEV_IPC.saveNow, () => cb());
      },
      ackSaveNow: () => ipcRenderer.send(DEV_IPC.saveNowAck),
    };
  }
}

contextBridge.exposeInMainWorld('waterplayDesktop', bridge);
