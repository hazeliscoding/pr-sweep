/**
 * Registers every `ipcMain.handle` channel the renderer invokes. Channel names
 * map 1:1 to the methods on window.api (see preload.ts) and the PrSweepApi type
 * in shared/types.ts — adding a feature means touching all three.
 *
 * Handlers are thin: unwrap args, delegate to a service. Business logic stays
 * in core/ where it's testable without Electron.
 */
import { dialog, ipcMain, shell } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { activeProfile, ConfigService } from './core/config.service';
import { GithubService } from './core/github.service';
import { DEFAULT_OAUTH_CLIENT_ID } from './core/oauth.constants';
import { pollForToken, requestDeviceCode } from './core/oauth.service';
import { SnapshotStore } from './core/snapshot.store';
import { TokenStore } from './core/token.store';
import { AuthStatus, DateRange, Profile, SweepConfigPatch } from '../shared/types';

export interface Services {
  config: ConfigService;
  tokens: TokenStore;
  github: GithubService;
  snapshots: SnapshotStore;
}

export function registerIpc(services: Services): void {
  ipcMain.handle('config:get', () => services.config.get());
  ipcMain.handle('config:set', (_e, patch: SweepConfigPatch) => services.config.set(patch ?? {}));

  ipcMain.handle('auth:status', () => authStatus(services));
  ipcMain.handle('auth:setToken', async (_e, token: string) => {
    services.tokens.set(String(token ?? '').trim());
    const status = await authStatus(services);
    // A token that doesn't fully work is worse than no token (every sweep
    // would fail, or worse, silently show an empty board) — don't keep it.
    if (!status.login || status.error) services.tokens.clear();
    return status;
  });
  ipcMain.handle('auth:clear', (): AuthStatus => {
    services.tokens.clear();
    return { hasToken: false, login: null, error: null };
  });

  ipcMain.handle('oauth:available', () => !!oauthClientId(services));
  ipcMain.handle('oauth:login', async (event) => {
    const clientId = oauthClientId(services);
    if (!clientId) throw new Error('Device-flow sign-in is not configured.');
    const dc = await requestDeviceCode(clientId);
    // Show the code to the user, then open GitHub's verification page for them.
    event.sender.send('oauth:code', { userCode: dc.userCode, verificationUri: dc.verificationUri });
    await shell.openExternal(dc.verificationUri);
    services.tokens.set(await pollForToken(clientId, dc));
    const status = await authStatus(services);
    if (!status.login || status.error) services.tokens.clear();
    return status;
  });

  ipcMain.handle('prs:fetch', async (_e, range: DateRange) => {
    const result = await services.github.sweep(services.config.get(), range);
    services.snapshots.set(result);
    return result;
  });
  ipcMain.handle('prs:latest', () => services.snapshots.get());

  ipcMain.handle('shell:open', (_e, url: string) => {
    // The renderer only ever passes PR URLs, but shell.openExternal is the one
    // place renderer data touches the OS — allow-list it.
    if (/^https:\/\/github\.com\//.test(String(url))) return shell.openExternal(url);
    return Promise.resolve();
  });

  // Export/import the shareable profiles only — never the token or machine prefs.
  ipcMain.handle('config:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export profiles',
      defaultPath: 'pr-sweep-profiles.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return false;
    const payload = { kind: 'pr-sweep-profiles', version: 1, profiles: services.config.get().profiles };
    writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return true;
  });
  ipcMain.handle('config:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import profiles',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths[0]) return null;
    const parsed = JSON.parse(readFileSync(filePaths[0], 'utf8'));
    const incoming: Profile[] = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    if (!incoming.length) throw new Error('No profiles found in that file.');
    const config = services.config.get();
    // Append imported profiles under fresh ids (names may collide; that's fine),
    // and switch to the first one so the import is immediately visible.
    const added = incoming.map((p, i) => ({ ...p, id: `imported-${Date.now()}-${i}` }));
    return services.config.set({
      profiles: [...config.profiles, ...added],
      activeProfileId: added[0].id,
    });
  });
}

/** Per-install override wins over the baked-in default (either may be empty). */
function oauthClientId(services: Services): string {
  return services.config.get().oauthClientId?.trim() || DEFAULT_OAUTH_CLIENT_ID;
}

async function authStatus(services: Services): Promise<AuthStatus> {
  if (!services.tokens.get()) return { hasToken: false, login: null, error: null };
  try {
    const org = activeProfile(services.config.get()).org;
    // Both probes hit the network; run them together — this check gates first
    // paint of live data on every boot.
    const [login, orgOk] = await Promise.all([
      services.github.viewer(),
      org ? services.github.orgVisible(org) : Promise.resolve(false),
    ]);
    if (!org) return { hasToken: true, login, error: 'No GitHub organization configured yet.' };
    if (!orgOk) {
      return {
        hasToken: true,
        login,
        error:
          `This token signs in as ${login} but can't see ${org}. ` +
          `If the org uses SAML SSO, open the token on github.com → "Configure SSO" → authorize ${org}, ` +
          `then paste it again. Also check it has the repo and read:org scopes.`,
      };
    }
    return { hasToken: true, login, error: null };
  } catch (e) {
    return { hasToken: true, login: null, error: (e as Error).message };
  }
}
