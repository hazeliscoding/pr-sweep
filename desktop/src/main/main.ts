/**
 * Electron main-process entry point. Wires config + token + GitHub services to
 * the IPC handlers the renderer calls through window.api and creates the single
 * window. In dev it loads the Angular dev server (ELECTRON_RENDERER_URL) and
 * opens DevTools; packaged it loads the built renderer/index.html from disk.
 */
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ConfigService } from './core/config.service';
import { GithubService } from './core/github.service';
import { TokenStore } from './core/token.store';
import { registerIpc } from './ipc';

// Consistent userData folder in dev ("pr-sweep-desktop" would be used otherwise).
app.setName('pr-sweep');

let win: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#fefefe',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('dev.prsweep.app');

  const userDataDir = app.getPath('userData');
  const tokens = new TokenStore(path.join(userDataDir, 'token.bin'));
  registerIpc({
    config: new ConfigService(path.join(userDataDir, 'config.json')),
    tokens,
    github: new GithubService(() => tokens.get()),
  });
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
