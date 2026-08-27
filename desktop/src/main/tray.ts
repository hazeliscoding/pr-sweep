/**
 * System-tray presence and review-queue notifications. The renderer pushes its
 * latest queue after every sweep (see the 'tray:sync' IPC); this module turns
 * that into a tray tooltip with live counts, an alert-badged icon when your
 * queue is non-empty, and a desktop toast for each PR that newly lands in it.
 */
import { app, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import * as path from 'path';
import { ConfigService } from './core/config.service';
import { PrRow } from '../shared/types';

export interface TraySync {
  queue: PrRow[];
  needsReviewCount: number;
}

const key = (pr: PrRow): string => `${pr.repo}#${pr.number}`;

export class TrayController {
  private tray: Tray | null = null;
  private readonly iconIdle: Electron.NativeImage;
  private readonly iconAlert: Electron.NativeImage;
  /** null until the first sync — so a queue that's non-empty at launch doesn't
      toast every item as if it were brand new. */
  private known: Set<string> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly showWindow: () => void,
    private readonly quit: () => void,
  ) {
    const dir = path.join(app.getAppPath(), 'build');
    this.iconIdle = nativeImage.createFromPath(path.join(dir, 'tray.png'));
    this.iconAlert = nativeImage.createFromPath(path.join(dir, 'tray-alert.png'));
  }

  /** Safe to fail — a machine without a system tray simply gets no tray. */
  init(): void {
    this.tray = new Tray(this.iconIdle.resize({ width: 16, height: 16 }));
    this.tray.setToolTip('PR Sweep');
    this.tray.on('click', this.showWindow);
    this.render(0, 0);
  }

  sync({ queue, needsReviewCount }: TraySync): void {
    const keys = new Set(queue.map(key));
    if (this.known && this.config.get().notifications && Notification.isSupported()) {
      for (const pr of queue) {
        if (!this.known.has(key(pr))) this.notify(pr);
      }
    }
    this.known = keys;
    this.render(queue.length, needsReviewCount);
  }

  private notify(pr: PrRow): void {
    const n = new Notification({
      title: 'Review requested',
      body: `${key(pr)} — ${pr.title}`,
    });
    n.on('click', () => {
      this.showWindow();
      void shell.openExternal(pr.url);
    });
    n.show();
  }

  private render(queueCount: number, needsReviewCount: number): void {
    if (!this.tray) return;
    this.tray.setImage(
      (queueCount > 0 ? this.iconAlert : this.iconIdle).resize({ width: 16, height: 16 }),
    );
    const line =
      queueCount > 0
        ? `${queueCount} awaiting your review`
        : needsReviewCount > 0
          ? `${needsReviewCount} need review`
          : 'nothing waiting';
    this.tray.setToolTip(`PR Sweep — ${line}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `${queueCount} awaiting your review`, enabled: false },
        { label: `${needsReviewCount} need review (team)`, enabled: false },
        { type: 'separator' },
        { label: 'Open PR Sweep', click: this.showWindow },
        { label: 'Quit', click: this.quit },
      ]),
    );
  }
}
