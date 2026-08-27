/**
 * Registers every `ipcMain.handle` channel the renderer invokes. Channel names
 * map 1:1 to the methods on window.api (see preload.ts) and the PrSweepApi type
 * in shared/types.ts — adding a feature means touching all three.
 *
 * Handlers are thin: unwrap args, delegate to a service. Business logic stays
 * in core/ where it's testable without Electron.
 */
import { ipcMain, shell } from 'electron';
import { ConfigService } from './core/config.service';
import { GithubService } from './core/github.service';
import { SnapshotStore } from './core/snapshot.store';
import { TokenStore } from './core/token.store';
import { AuthStatus, DateRange, SweepConfigPatch } from '../shared/types';

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
}

async function authStatus(services: Services): Promise<AuthStatus> {
  if (!services.tokens.get()) return { hasToken: false, login: null, error: null };
  try {
    const org = services.config.get().org;
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
