/**
 * Preload bridge: the only surface the (context-isolated) renderer can touch in
 * the main process. Each method is a typed wrapper over ipcRenderer.invoke whose
 * channel name matches a handler in ipc.ts 1:1 — keep this object, {@link PrSweepApi},
 * and registerIpc in sync. Exposed on `window.api`.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { PrSweepApi } from '../shared/types';

const api: PrSweepApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  setToken: (token) => ipcRenderer.invoke('auth:setToken', token),
  clearToken: () => ipcRenderer.invoke('auth:clear'),
  oauthAvailable: () => ipcRenderer.invoke('oauth:available'),
  startOAuth: () => ipcRenderer.invoke('oauth:login'),
  onOAuthCode: (cb) => {
    // Fresh listener each call so a retried sign-in doesn't stack handlers.
    ipcRenderer.removeAllListeners('oauth:code');
    ipcRenderer.on('oauth:code', (_e, info) => cb(info));
  },
  fetchPrs: (range) => ipcRenderer.invoke('prs:fetch', range),
  latestSweep: () => ipcRenderer.invoke('prs:latest'),
  syncTray: (sync) => ipcRenderer.invoke('tray:sync', sync),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
};

contextBridge.exposeInMainWorld('api', api);
