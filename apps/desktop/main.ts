import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { parseDesktopArgs } from './args.ts';
import { installDevIpc } from './dev-ipc.ts';

/** Replaced by esbuild: true for dev-electron.ts, false for production builds. */
declare const __DEV__: boolean;

const args = parseDesktopArgs(process.argv);
const isDev = __DEV__ && args.devServerUrl !== null;

if (isDev) {
  // Separate userData per instance so storage and caches don't collide (§13.4.2).
  app.setPath('userData', join(app.getPath('userData'), `dev-${args.instance}`));
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.floor(area.width / args.slots);
  const win = new BrowserWindow({
    x: area.x + width * args.slot,
    y: area.y,
    width,
    height: Math.floor(area.height * (args.slots > 1 ? 0.8 : 0.9)),
    title: isDev ? `Waterplay [${args.instance} · ${args.role}]` : 'Waterplay',
    backgroundColor: '#9fd8f0',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (isDev && args.devServerUrl) void win.loadURL(args.devServerUrl);
  else void win.loadFile(join(__dirname, '../dist/web/index.html'));
  return win;
}

// Literal __DEV__ check so esbuild drops dev-ipc entirely from production builds.
if (__DEV__) installDevIpc(args, isDev, () => mainWindow);

app.whenReady().then(() => {
  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

app.on('window-all-closed', () => app.quit());
