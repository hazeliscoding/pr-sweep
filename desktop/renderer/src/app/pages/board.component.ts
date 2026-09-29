import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BoardStore } from '../board.store';
import { Attention, AttentionReason, PrRow, SprintSummary } from '../models';
import { CiStatusComponent } from '../ui/ci-status.component';
import { IconComponent } from '../ui/icon.component';

const REASON_LABELS: Record<AttentionReason, string> = {
  CI_FAILING: 'CI failing',
  MERGE_CONFLICT: 'Merge conflict',
  CHANGES_NOT_ADDRESSED: 'Changes not addressed',
  NEEDS_RE_REVIEW: 'Needs re-review',
  APPROVED_NOT_MERGED: 'Approved, not merged',
  NO_REVIEWERS: 'No reviewers',
  WAITING_FOR_REVIEW: 'Waiting for review',
  STALE: 'Stale',
  DRAFT_TOO_LONG: 'Old draft',
};

interface BoardSection {
  id: string;
  title: string;
  rows: PrRow[];
  /** Merged rows date from merge time and don't have outstanding reviewers or CI. */
  merged: boolean;
  /** The "waiting on my review" section gets review-wait tags, and author chips don't apply to it. */
  queue?: boolean;
  emptyNote: string;
}

/** One cell of the health strip: a number, and a dot and a note that say whether it's fine. */
interface HealthCell {
  label: string;
  value: string | null;
  tone: 'healthy' | 'warning' | 'critical' | 'info' | null;
  note: string;
}

const HEALTH_LABELS = ['Days left', 'Open', 'Needs attention', 'Merged', 'Time to merge'];
/** How long the Copy standup confirmation stays up. */
const COPIED_MS = 6000;

const SKELETON_ROWS = [1, 2, 3];
const SWEEP_SKELETON_ROWS = [1, 2, 3, 4, 5];

/**
 * The dashboard: the sprint's story in a health strip, with Copy standup,
 * then the filter bar (author chips,
 * drafts, free text), the Sweep (open PRs the attention engine flagged, each
 * with its reason and next step), then one dense table per status: my queue,
 * needs review, changes requested, approved, merged. All slicing is
 * client-side over the store's fetched result; a status row opens its PR in
 * the default browser.
 */
@Component({
  selector: 'app-board',
  standalone: true,
  imports: [NgTemplateOutlet, CiStatusComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The whole team's numbers: author chips, search and snoozes don't change them. -->
    <section class="health" [class.health--with-action]="canCopyStandup()" aria-label="Sprint health">
      @for (cell of health(); track cell.label) {
        <div class="health__cell">
          <span class="q-label">{{ cell.label }}</span>
          <span class="health__value">{{ cell.value ?? '–' }}</span>
          <span class="health__note">
            @if (cell.tone) {
              <span class="q-dot q-dot--{{ cell.tone }}" aria-hidden="true"></span>
            }
            {{ cell.note }}
          </span>
        </div>
      }
      @if (canCopyStandup()) {
        <div class="health__cell health__cell--action">
          <span class="q-label">Standup</span>
          <button class="q-btn" (click)="copyStandup()">
            <q-icon [name]="copied() ? 'check' : 'clipboard-copy'" />
            {{ copied() ? 'Copied' : 'Copy standup' }}
          </button>
          <span class="health__note">For Teams, Slack or Discord</span>
        </div>
      }
    </section>
    <p class="standup-status" [class.standup-status--error]="standupFailed()" role="status">{{ standupMessage() }}</p>

    <div class="filters">
      <div class="filters__group" role="group" aria-labelledby="authors-label">
        <span id="authors-label" class="q-label">Authors</span>
        @for (login of authors(); track login) {
          <button
            class="q-chip q-chip--mono"
            [attr.aria-pressed]="store.authorFilter().has(login)"
            (click)="store.toggleAuthor(login)"
          >
            @if (store.authorFilter().has(login)) {
              <q-icon name="check" [size]="12" />
            }
            {{ login }}
          </button>
        }
      </div>
      <button
        class="q-chip"
        title="Include draft PRs"
        [attr.aria-pressed]="!!store.activeProfile()?.includeDrafts"
        (click)="store.toggleDrafts()"
      >
        @if (store.activeProfile()?.includeDrafts) {
          <q-icon name="check" [size]="12" />
        }
        Drafts
      </button>
      @if (store.filtering()) {
        <button class="q-btn q-btn--ghost q-btn--sm" (click)="store.clearFilters()">Clear filters</button>
      }
      <label class="q-search">
        <q-icon name="search" />
        <input
          class="q-input q-input--mono"
          type="search"
          placeholder="Filter by title or repo"
          aria-label="Filter by title or repo"
          [value]="store.search()"
          (input)="store.search.set($any($event.target).value)"
        />
      </label>
    </div>

    <section class="board-section" aria-labelledby="sweep-title">
      <header class="board-section__head">
        <h2 id="sweep-title" class="board-section__title">
          Sweep
          @if (store.result()) {
            <span class="board-section__count">{{ store.sweep().length }}</span>
          }
        </h2>
        <span class="board-section__actions">
          @if (store.quiet().length > 0) {
            <button
              class="q-chip"
              title="Only waiting or stale, or untouched for a month"
              [attr.aria-pressed]="store.showQuiet()"
              (click)="store.showQuiet.set(!store.showQuiet())"
            >
              <q-icon [name]="store.showQuiet() ? 'eye' : 'eye-off'" [size]="12" />
              Show quiet ({{ store.quiet().length }})
            </button>
          }
          @if (store.snoozed().length > 0) {
            <button
              class="q-chip"
              [attr.aria-pressed]="store.showSnoozed()"
              (click)="store.showSnoozed.set(!store.showSnoozed())"
            >
              <q-icon [name]="store.showSnoozed() ? 'eye' : 'eye-off'" [size]="12" />
              Show snoozed ({{ store.snoozed().length }})
            </button>
          }
        </span>
      </header>
      @if (!store.result()) {
        @if (store.loading()) {
          <ng-container *ngTemplateOutlet="skeleton; context: { rows: sweepSkeleton }" />
        } @else {
          <div class="q-empty">
            <q-icon name="refresh-cw" [size]="20" />
            <p class="q-empty__title">No pull requests yet</p>
            <p class="q-empty__meta">Refresh to sweep this period.</p>
          </div>
        }
      } @else if (sweepRows().length > 0) {
        <div class="q-table-wrap">
          <table class="q-table" data-density="compact">
            <thead>
              <tr>
                <th scope="col" class="col-ref">PR</th>
                <th scope="col" class="col-ci">CI</th>
                <th scope="col" class="col-title">Title</th>
                <th scope="col">Why</th>
                <th scope="col">Author</th>
                <th scope="col" class="col-next">Next step</th>
              </tr>
            </thead>
            <tbody>
              <!-- Rows aren't one big button here: they hold buttons of their own. -->
              @for (pr of sweepRows(); track pr.url) {
                <tr [class.is-muted]="pr.quiet || store.isSnoozed(pr)">
                  <td class="col-ref mono">{{ pr.repo }}#{{ pr.number }}</td>
                  <td class="col-ci"><q-ci [state]="pr.ci" /></td>
                  <td class="col-title">
                    <span class="title-cell">
                      <button
                        class="pr-link"
                        [title]="pr.url"
                        [attr.aria-label]="'Open ' + pr.repo + '#' + pr.number + ': ' + pr.title"
                        (click)="store.openPr(pr)"
                      >
                        {{ pr.title }}
                      </button>
                      @if (pr.isDraft) {
                        <span class="q-tag">draft</span>
                      }
                    </span>
                  </td>
                  <td>
                    <span class="reason reason--{{ tier(pr.attention[0]) }}">
                      <span class="q-dot" aria-hidden="true"></span>
                      <span class="reason__label">{{ label(pr.attention[0]) }}</span>
                      @if (pr.attention[0].since; as since) {
                        <span class="reason__age" [title]="'Since ' + since">{{ age(since) }}</span>
                      }
                      @for (other of pr.attention.slice(1); track other.reason) {
                        <span class="q-tag">{{ label(other) }}</span>
                      }
                      @if (pr.quiet) {
                        <span class="q-tag">quiet</span>
                      } @else if (store.isSnoozed(pr)) {
                        <span class="q-tag">snoozed</span>
                      }
                    </span>
                  </td>
                  <td class="col-author">{{ pr.author }}</td>
                  <td class="col-next">
                    <span class="next-step">
                      <button
                        class="q-btn q-btn--sm"
                        [attr.aria-label]="pr.attention[0].action + ': ' + pr.repo + '#' + pr.number"
                        (click)="store.openUrl(pr.attention[0].href)"
                      >
                        {{ pr.attention[0].action }}
                        <q-icon name="external-link" [size]="12" />
                      </button>
                      @if (pr.quiet) {
                        <!-- quiet rows have no snooze: they're already out of the way -->
                      } @else if (store.isSnoozed(pr)) {
                        <button
                          class="q-btn q-btn--ghost q-btn--sm"
                          [attr.aria-label]="'Unsnooze ' + pr.repo + '#' + pr.number"
                          (click)="store.unsnooze(pr)"
                        >
                          Unsnooze
                        </button>
                      } @else {
                        <button
                          class="q-btn q-btn--ghost q-btn--sm"
                          title="Hide until it changes, gets worse, or tomorrow"
                          [attr.aria-label]="'Snooze ' + pr.repo + '#' + pr.number"
                          (click)="store.snooze(pr)"
                        >
                          <q-icon name="bell-off" [size]="12" />
                          Snooze
                        </button>
                      }
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (store.filtering()) {
        <div class="q-empty">
          <q-icon name="search" [size]="20" />
          <p class="q-empty__title">No PRs match these filters</p>
          <p class="q-empty__meta">Nothing flagged among the PRs these filters show.</p>
        </div>
      } @else {
        <div class="q-empty q-empty--good">
          <q-icon name="circle-check" [size]="20" />
          <p class="q-empty__title">Nothing needs attention</p>
          @if (hiddenNote(); as note) {
            <p class="q-empty__meta">{{ note }}</p>
          }
        </div>
      }
    </section>

    <!-- Before the first sweep, the status tables only show while one is loading. -->
    @for (section of store.result() || store.loading() ? sections() : []; track section.id) {
      <section class="board-section" [attr.aria-labelledby]="section.id">
        <header class="board-section__head">
          <h2 [id]="section.id" class="board-section__title">
            {{ section.title }}
            @if (store.result()) {
              <span class="board-section__count">{{ section.rows.length }}</span>
            }
          </h2>
        </header>
        @if (!store.result()) {
          <ng-container *ngTemplateOutlet="skeleton; context: { rows: skeletonRows }" />
        } @else if (section.rows.length > 0) {
          <div class="q-table-wrap">
            <table class="q-table" data-density="dense">
              <thead>
                <tr>
                  <th scope="col" class="col-ref">PR</th>
                  @if (!section.merged) {
                    <th scope="col" class="col-ci">CI</th>
                  }
                  <th scope="col" class="col-title">Title</th>
                  <th scope="col">Author</th>
                  <th scope="col" class="num">Comments</th>
                  <th scope="col" class="num">
                    <span aria-hidden="true" title="Lines added and removed">Δ</span>
                    <span class="sr-only">Lines changed</span>
                  </th>
                  @if (!section.merged) {
                    <th scope="col">Awaiting</th>
                  }
                  <th scope="col" class="num">{{ section.merged ? 'Merged' : 'Updated' }}</th>
                </tr>
              </thead>
              <tbody>
                @for (pr of section.rows; track pr.url) {
                  <tr
                    class="clickable"
                    tabindex="0"
                    role="button"
                    [attr.aria-label]="'Open ' + pr.repo + '#' + pr.number + ': ' + pr.title"
                    [title]="pr.url"
                    (click)="store.openPr(pr)"
                    (keydown.enter)="store.openPr(pr)"
                    (keydown.space)="store.openPr(pr); $event.preventDefault()"
                  >
                    <td class="col-ref mono">{{ pr.repo }}#{{ pr.number }}</td>
                    @if (!section.merged) {
                      <td class="col-ci"><q-ci [state]="pr.ci" /></td>
                    }
                    <td class="col-title">
                      <span class="title-cell">
                        <span class="pr-title">{{ pr.title }}</span>
                        @if (pr.isDraft) {
                          <span class="q-tag">draft</span>
                        }
                        @if (section.queue && waitingDays(pr) >= 1) {
                          <span
                            class="q-tag"
                            [class.q-tag--warning]="isWaitHot(pr)"
                            [title]="'Your review was requested ' + waitingDays(pr) + ' day(s) ago'"
                          >
                            waiting {{ waitingDays(pr) }}d
                          </span>
                        }
                      </span>
                    </td>
                    <td class="col-author">{{ pr.author }}</td>
                    <td class="num mono">{{ pr.comments || '' }}</td>
                    <td class="num mono">
                      <span class="delta-add">+{{ pr.additions }}</span>
                      <span class="delta-del">−{{ pr.deletions }}</span>
                    </td>
                    @if (!section.merged) {
                      <td class="col-awaiting">{{ pr.requestedReviewers.join(', ') }}</td>
                    }
                    @if (!section.merged && isStale(pr)) {
                      <td class="num mono is-stale" [title]="'Untouched for ' + staleDays() + '+ days'">
                        <q-icon name="clock" [size]="12" />
                        {{ ago(pr) }}
                      </td>
                    } @else {
                      <td class="num mono age">{{ ago(pr) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="q-empty q-empty--inline">{{ filteredOut(section) ? 'No PRs match these filters.' : section.emptyNote }}</p>
        }
      </section>
    }

    <ng-template #skeleton let-rows="rows">
      <div class="q-table-wrap skeleton" role="status">
        <span class="sr-only">Loading pull requests</span>
        @for (row of rows; track row) {
          <div class="skeleton__row" aria-hidden="true">
            <span class="skeleton__bar"></span>
            <span class="skeleton__bar"></span>
            <span class="skeleton__bar"></span>
            <span class="skeleton__bar"></span>
          </div>
        }
      </div>
    </ng-template>
  `,
})
export class BoardComponent {
  readonly store = inject(BoardStore);
  readonly skeletonRows = SKELETON_ROWS;
  readonly sweepSkeleton = SWEEP_SKELETON_ROWS;

  readonly sections = computed<BoardSection[]>(() => {
    const period = this.store.period();
    return [
      {
        id: 'queue-title',
        title: 'Waiting on my review',
        rows: this.store.queue(),
        merged: false,
        queue: true,
        emptyNote: 'Nothing waiting on you.',
      },
      {
        id: 'review-title',
        title: 'Needs review',
        rows: this.store.needsReview(),
        merged: false,
        emptyNote: 'Nothing waiting on review.',
      },
      {
        id: 'changes-title',
        title: 'Changes requested',
        rows: this.store.changesRequested(),
        merged: false,
        emptyNote: 'Nothing sent back for changes.',
      },
      {
        id: 'approved-title',
        title: 'Approved, ready to merge',
        rows: this.store.approved(),
        merged: false,
        emptyNote: 'Nothing approved and waiting to merge.',
      },
      {
        id: 'merged-title',
        title: period?.sprint ? `Merged in ${period.sprint.name}` : 'Merged in this range',
        rows: this.store.merged(),
        merged: true,
        emptyNote: period?.sprint ? `Nothing merged in ${period.sprint.name} yet.` : 'Nothing merged in this range yet.',
      },
    ];
  });

  readonly health = computed<HealthCell[]>(() => {
    const s = this.store.summary();
    if (!s) return HEALTH_LABELS.map((label) => ({ label, value: null, tone: null, note: '' }));
    const [days, open, attention, merged, time] = HEALTH_LABELS;
    const sprint = this.store.period()?.sprint;
    return [
      { label: days, ...daysLeft(s) },
      {
        label: open,
        value: String(s.open),
        // The sprint-end warning: what isn't approved, in the sprint's last two days.
        tone: s.notApproved === 0 ? 'healthy' : s.endingSoon ? 'warning' : 'info',
        note:
          s.notApproved > 0
            ? `${s.notApproved} not approved${s.endingSoon ? ' yet' : ''}`
            : s.open > 0
              ? 'All approved'
              : 'Nothing open',
      },
      {
        label: attention,
        value: String(s.needsAttention),
        tone: s.blocked > 0 ? 'critical' : s.needsAttention > 0 ? 'warning' : 'healthy',
        note:
          s.blocked > 0
            ? `${s.blocked} blocked`
            : s.needsAttention > 0
              ? 'None blocked'
              : s.quiet > 0
                ? `${s.quiet} quiet, not counted`
                : 'Nothing flagged',
      },
      {
        label: merged,
        value: String(s.merged),
        tone: 'info',
        note: s.when === 'during' ? `${s.mergedSince} since ${s.sinceLabel}` : sprint ? `In ${sprint.name}` : 'In this range',
      },
      {
        label: time,
        value: s.medianMergeMs === null ? null : duration(s.medianMergeMs),
        tone: null,
        note: s.merged ? `Median of ${s.merged} PR${s.merged === 1 ? '' : 's'}` : 'Nothing merged yet',
      },
    ];
  });

  /** A standup covers today, so it's offered only while the board shows a period that includes it. */
  readonly canCopyStandup = computed(() => this.store.summary()?.when === 'during');
  readonly copied = signal(false);
  readonly standupMessage = signal('');
  readonly standupFailed = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  /** Active Sweep rows, then the snoozed and quiet ones when they're revealed. */
  readonly sweepRows = computed(() => [
    ...this.store.sweep(),
    ...(this.store.showSnoozed() ? this.store.snoozed() : []),
    ...(this.store.showQuiet() ? this.store.quiet() : []),
  ]);

  /** "2 snoozed · 12 quiet" for the empty state; null when nothing is hidden. */
  readonly hiddenNote = computed(() => {
    const parts = [
      this.store.snoozed().length ? `${this.store.snoozed().length} snoozed` : '',
      this.store.quiet().length ? `${this.store.quiet().length} quiet` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  });

  readonly staleDays = computed(() => this.store.activeProfile()?.staleDays ?? 0);

  authors(): string[] {
    return this.store.activeProfile()?.authors ?? [];
  }

  /** The queue ignores author chips, so only the text filter can empty it. */
  filteredOut(section: BoardSection): boolean {
    return section.queue ? this.store.search().trim() !== '' : this.store.filtering();
  }

  /** Untouched longer than the configured threshold (0 = feature off). */
  isStale(pr: PrRow): boolean {
    const days = this.staleDays();
    return days > 0 && Date.now() - Date.parse(pr.updatedAt) > days * 86_400_000;
  }

  /** Whole days since the viewer's review was requested (0 when unknown). */
  waitingDays(pr: PrRow): number {
    if (!pr.reviewRequestedAt) return 0;
    return Math.floor((Date.now() - Date.parse(pr.reviewRequestedAt)) / 86_400_000);
  }

  /** Waiting past the same threshold the stale flag uses (0 = never hot). */
  isWaitHot(pr: PrRow): boolean {
    const days = this.staleDays();
    return days > 0 && this.waitingDays(pr) >= days;
  }

  label(a: Attention): string {
    return REASON_LABELS[a.reason];
  }

  /** Color tier: red for CI and conflicts, amber for stuck reviews and merges, muted for waiting. */
  tier(a: Attention): 'hot' | 'warm' | 'cool' {
    return a.severity <= 2 ? 'hot' : a.severity <= 5 ? 'warm' : 'cool';
  }

  /** How long a reason has held: "12m", "5h", "3d". */
  age(since: string): string {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 60000));
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
  }

  ago(pr: PrRow): string {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(pr.mergedAt ?? pr.updatedAt)) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }

  async copyStandup(): Promise<void> {
    clearTimeout(this.copiedTimer);
    try {
      const c = await this.store.copyStandup();
      const attention = `${c.attention} ${c.attention === 1 ? 'needs' : 'need'} attention`;
      this.standupFailed.set(false);
      this.standupMessage.set(`Copied: ${c.merged} merged, ${c.blocked} blocked, ${attention}, ${c.review} in review.`);
      this.copied.set(true);
    } catch {
      this.standupFailed.set(true);
      this.standupMessage.set("Couldn't copy the standup. Try again after the next refresh.");
      this.copied.set(false);
    }
    this.copiedTimer = setTimeout(() => {
      this.copied.set(false);
      this.standupMessage.set('');
    }, COPIED_MS);
  }
}

/** The Days left cell: a count while the period runs, otherwise when it starts or ended. */
function daysLeft(s: SprintSummary): Omit<HealthCell, 'label'> {
  if (s.when === 'before') return { value: null, tone: 'info', note: `Starts ${s.startLabel}` };
  if (s.when === 'after') return { value: null, tone: 'info', note: `Ended ${s.endLabel}` };
  if (s.daysLeft === null) return { value: null, tone: 'info', note: 'No end date' };
  return {
    value: String(s.daysLeft),
    tone: s.endingSoon && s.notApproved > 0 ? 'warning' : 'info',
    note: s.daysLeft === 0 ? 'Ends today' : `Ends ${s.endLabel}`,
  };
}

/** "35m", "14h", "1.8d". */
function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const hours = min / 60;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Number((hours / 24).toFixed(1))}d`;
}
