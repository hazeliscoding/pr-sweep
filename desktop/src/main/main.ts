/**
 * Electron main-process entry point. Wires config + token + GitHub services to
 * the IPC handlers the renderer calls through window.api, creates the single
 * window, and runs the tray. With close-to-tray enabled (default), closing the
 * window hides it so the app keeps sweeping and can toast review requests;
 * quit for real via the tray menu. In dev it loads the Angular dev server
 * (ELECTRON_RENDERER_URL) and opens DevTools; packaged it loads the built
 * renderer/index.html from disk.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import { ConfigService } from './core/config.service';
import { GithubService } from './core/github.service';
import { SnapshotStore } from './core/snapshot.store';
import { TokenStore } from './core/token.store';
import { registerIpc, Services } from './ipc';
import { TrayController, TraySync } from './tray';

// Keep the userData folder at %APPDATA%/pr-sweep even though the product now
// displays as "PR Sweep" — existing configs and tokens must survive the rename.
// (Also keeps dev and packaged builds on the same folder.)
app.setName('pr-sweep');

// One instance owns the tray. Close-to-tray hides the window, so relaunching
// from the Start Menu is common — without this lock every launch spawns a
// second app (two tray icons, double sweeps, duplicate toasts). A second
// launch instead surfaces the running instance's window and exits.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();
app.on('second-instance', () => showWindow());

let win: BrowserWindow | null = null;
let tray: TrayController | null = null;
let services: Services | null = null;
let quitting = false;

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#fefefe',
    autoHideMenuBar: true,
    // Window + taskbar icon; shipped in the bundle (see electron-builder "files").
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Close-to-tray: hide instead of destroy so sweeps and notifications keep
  // running. A real quit (tray menu / app.quit) sets `quitting` via before-quit.
  win.on('close', (e) => {
    if (!quitting && services?.config.get().closeToTray) {
      e.preventDefault();
      win?.hide();
    }
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

function showWindow(): void {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    void createWindow();
  }
}

app.on('before-quit', () => {
  quitting = true;
});

/** How often a running (possibly tray-hidden) app looks for a new release. */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Auto-update for installed builds only — the portable exe has no update story
 * (PORTABLE_EXECUTABLE_DIR is set by its launcher), those users re-download.
 *
 * Close-to-tray means the app can run for weeks without a relaunch, so a
 * launch-only check would never fire for exactly the users who keep it open;
 * check on launch and on an interval instead. Progress is pushed to the
 * renderer (header pill) and the taskbar; when the download is ready the
 * renderer and tray both offer "restart to update" (no forced restart).
 */
function setupAutoUpdate(): void {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;

  const send = (state: { status: 'downloading' | 'ready'; version: string; percent: number } | null) =>
    win?.webContents.send('update:state', state);
  const install = () => {
    quitting = true;
    // isSilent: the assisted (non-one-click) installer would otherwise replay
    // its full wizard UI on every update — silent reuses the existing install
    // dir. isForceRunAfter: relaunch on the new version when it's done.
    autoUpdater.quitAndInstall(true, true);
  };
  ipcMain.handle('update:install', () => install());

  let version = '';
  autoUpdater.on('update-available', (info) => {
    version = info.version;
    send({ status: 'downloading', version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => {
    send({ status: 'downloading', version, percent: Math.round(p.percent) });
    win?.setProgressBar(p.percent / 100);
  });
  autoUpdater.on('update-downloaded', (info) => {
    send({ status: 'ready', version: info.version, percent: 100 });
    win?.setProgressBar(-1);
    tray?.setUpdateReady(info.version, install);
  });
  autoUpdater.on('error', (err) => {
    // A failed check or download isn't actionable mid-session — clear the UI
    // and let the next interval try again.
    console.warn('[pr-sweep] auto-update error:', err?.message ?? err);
    send(null);
    win?.setProgressBar(-1);
  });

  const check = () =>
    autoUpdater
      .checkForUpdates()
      .catch((err) => console.warn('[pr-sweep] update check failed:', err?.message ?? err));
  void check();
  setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
}

app.whenReady().then(async () => {
  // A losing second instance is already quitting — don't flash a window/tray
  // in the moment before the quit lands.
  if (!isPrimaryInstance) return;
  if (process.platform === 'win32') app.setAppUserModelId('dev.prsweep.app');

  const userDataDir = app.getPath('userData');
  const tokens = new TokenStore(path.join(userDataDir, 'token.bin'));
  services = {
    config: new ConfigService(path.join(userDataDir, 'config.json')),
    tokens,
    github: new GithubService(() => tokens.get()),
    snapshots: new SnapshotStore(path.join(userDataDir, 'snapshot.json')),
  };
  registerIpc(services);

  // The renderer pushes its queue after each sweep; the tray turns it into
  // counts + toasts. A tray failure (e.g. no system tray) must never take the
  // app down, so degrade quietly to no tray.
  try {
    tray = new TrayController(services.config, showWindow, () => app.quit());
    tray.init();
    ipcMain.handle('tray:sync', (_e, sync: TraySync) => tray?.sync(sync));
  } catch (e) {
    console.warn('[pr-sweep] tray unavailable:', (e as Error).message);
    ipcMain.handle('tray:sync', () => void 0);
  }

  await createWindow();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // With close-to-tray the window only hides, so reaching here means the user
  // really closed everything (toggle off) — quit like a normal app.
  if (!services?.config.get().closeToTray && process.platform !== 'darwin') app.quit();
});
