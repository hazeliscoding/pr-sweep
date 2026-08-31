/**
 * System-tray presence and desktop notifications. The renderer pushes the
 * tray-relevant slices of every sweep (see the 'tray:sync' IPC); this module
 * turns them into a tooltip with live counts, an alert-badged icon when your
 * queue is non-empty, and desktop toasts for the two directions of the daily
 * loop: reviewer-side (a PR newly lands in your queue) and author-side (one of
 * *your* PRs gets approved, gets changes requested, or starts failing CI).
 */
import { app, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import * as path from 'path';
import { ConfigService } from './core/config.service';
import { PrRow } from '../shared/types';

export interface TraySync {
  queue: PrRow[];
  /** The signed-in user's own open PRs — the author-side notification source. */
  mine: PrRow[];
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
  /** Same pattern for the author's own PRs: toast on transitions, not on launch. */
  private mineKnown: Map<string, { bucket: PrRow['bucket']; ci: PrRow['ci'] }> | null = null;
  private updateReady: { version: string; install: () => void } | null = null;
  /** Last synced counts so a menu rebuild outside sync() keeps them current. */
  private counts = { queue: 0, needsReview: 0 };

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

  sync({ queue, mine, needsReviewCount }: TraySync): void {
    const toastable = this.config.get().notifications && Notification.isSupported();
    const keys = new Set(queue.map(key));
    if (this.known && toastable) {
      for (const pr of queue) {
        if (!this.known.has(key(pr))) this.notify('Review requested', pr);
      }
    }
    this.known = keys;

    // Author-side: toast state *transitions* on PRs we already knew about.
    // A PR seen for the first time (launch, or freshly opened) sets a baseline
    // without toasting — its current state isn't news the user caused us to miss.
    const rows = mine ?? [];
    if (this.mineKnown && toastable) {
      for (const pr of rows) {
        const prev = this.mineKnown.get(key(pr));
        if (!prev) continue;
        if (pr.bucket !== prev.bucket && pr.bucket === 'approved') this.notify('PR approved', pr);
        if (pr.bucket !== prev.bucket && pr.bucket === 'changes-requested') {
          this.notify('Changes requested', pr);
        }
        if (pr.ci === 'failure' && prev.ci !== 'failure') this.notify('CI failed', pr);
      }
    }
    this.mineKnown = new Map(rows.map((pr) => [key(pr), { bucket: pr.bucket, ci: pr.ci }]));

    this.render(queue.length, needsReviewCount);
  }

  private notify(title: string, pr: PrRow): void {
    const n = new Notification({
      title,
      body: `${key(pr)} — ${pr.title}`,
    });
    n.on('click', () => {
      this.showWindow();
      void shell.openExternal(pr.url);
    });
    n.show();
  }

  /** A downloaded update adds a restart entry to the tray menu — the tray is
      the only surface a close-to-tray user reliably sees. */
  setUpdateReady(version: string, install: () => void): void {
    this.updateReady = { version, install };
    this.render(this.counts.queue, this.counts.needsReview);
  }

  private render(queueCount: number, needsReviewCount: number): void {
    if (!this.tray) return;
    this.counts = { queue: queueCount, needsReview: needsReviewCount };
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
    const update: Electron.MenuItemConstructorOptions[] = this.updateReady
      ? [
          { label: `Restart to update (v${this.updateReady.version})`, click: this.updateReady.install },
          { type: 'separator' },
        ]
      : [];
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        ...update,
        { label: `${queueCount} awaiting your review`, enabled: false },
        { label: `${needsReviewCount} need review (team)`, enabled: false },
        { type: 'separator' },
        { label: 'Open PR Sweep', click: this.showWindow },
        { label: 'Quit', click: this.quit },
      ]),
    );
  }
}
