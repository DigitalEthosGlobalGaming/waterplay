/** IPC channel names between main and preload (dev only). */
export const DEV_IPC = {
  info: 'dev:info',
  load: 'dev:session-load',
  save: 'dev:session-save',
  clear: 'dev:session-clear',
  saveNow: 'dev:save-now',
  saveNowAck: 'dev:save-now-ack',
} as const;

/** Messages between tools/dev-electron.ts and each Electron main process (Node IPC channel). */
export const ORCHESTRATOR = {
  saveNowMessage: 'waterplay:save-now',
  savedMessage: 'waterplay:saved',
} as const;
