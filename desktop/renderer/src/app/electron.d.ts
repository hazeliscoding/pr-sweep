import type { PrSweepApi } from './models';

declare global {
  interface Window {
    /** Typed IPC bridge installed by desktop/src/preload/preload.ts. */
    api: PrSweepApi;
  }
}

export {};
