import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BoardStore } from '../board.store';
import { PrRow } from '../models';

interface BoardSection {
  title: string;
  rows: PrRow[];
  /** Merged rows date from merge time and don't have outstanding reviewers. */
  merged: boolean;
  emptyNote: string;
}

/**
 * The dashboard: KPI counts, a filter toolbar (author toggles + free text),
 * and one dense table per status — needs review / changes requested /
 * approved / merged this sprint. All slicing is client-side over the store's
 * fetched result; clicking a row opens the PR in the default browser.
 */
@Component({
  selector: 'app-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="kpi-row">
      <div class="kpi kpi-review">
        <div class="kpi-label">Needs review</div>
        <div class="kpi-value">{{ store.needsReview().length }}</div>
      </div>
      <div class="kpi kpi-changes">
        <div class="kpi-label">Changes requested</div>
        <div class="kpi-value">{{ store.changesRequested().length }}</div>
      </div>
      <div class="kpi kpi-approved">
        <div class="kpi-label">Approved</div>
        <div class="kpi-value">{{ store.approved().length }}</div>
      </div>
      <div class="kpi kpi-merged">
        <div class="kpi-label">Merged in range</div>
        <div class="kpi-value">{{ store.merged().length }}</div>
      </div>
    </div>

    <div class="toolbar">
      <label>Authors</label>
      @for (login of authors(); track login) {
        <button
          class="toggle"
          [class.on]="store.authorFilter().has(login)"
          (click)="store.toggleAuthor(login)"
        >
          {{ login }}
        </button>
      }
      <span class="spacer"></span>
      <input
        class="search"
        type="search"
        placeholder="Filter by title or repo"
        [value]="store.search()"
        (input)="store.search.set($any($event.target).value)"
      />
    </div>

    @for (section of sections(); track section.title) {
      <section class="section">
        <h2>{{ section.title }} <span class="muted">({{ section.rows.length }})</span></h2>
        @if (section.rows.length > 0) {
          <table>
            <thead>
              <tr>
                <th>PR</th>
                <th>Title</th>
                <th>Author</th>
                <th class="num">Comments</th>
                <th class="num">Δ</th>
                @if (!section.merged) {
                  <th>Awaiting</th>
                }
                <th class="num">{{ section.merged ? 'Merged' : 'Updated' }}</th>
              </tr>
            </thead>
            <tbody>
              @for (pr of section.rows; track pr.url) {
                <tr class="clickable" (click)="store.openPr(pr)" [title]="pr.url">
                  <td class="pr-ref">{{ pr.repo }}#{{ pr.number }}</td>
                  <td>{{ pr.title }}</td>
                  <td>{{ pr.author }}</td>
                  <td class="num">{{ pr.comments || '' }}</td>
                  <td class="num">
                    <span class="pos">+{{ pr.additions }}</span>
                    <span class="neg">−{{ pr.deletions }}</span>
                  </td>
                  @if (!section.merged) {
                    <td class="why">{{ pr.requestedReviewers.join(', ') }}</td>
                  }
                  <td class="num">{{ ago(pr) }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="empty-note">{{ section.emptyNote }}</p>
        }
      </section>
    }
  `,
})
export class BoardComponent {
  readonly store = inject(BoardStore);

  readonly sections = computed<BoardSection[]>(() => [
    {
      title: 'Needs review',
      rows: this.store.needsReview(),
      merged: false,
      emptyNote: 'Nothing waiting on review.',
    },
    {
      title: 'Changes requested',
      rows: this.store.changesRequested(),
      merged: false,
      emptyNote: 'None.',
    },
    {
      title: 'Approved — ready to merge',
      rows: this.store.approved(),
      merged: false,
      emptyNote: 'None ready to merge.',
    },
    {
      title: 'Merged this sprint',
      rows: this.store.merged(),
      merged: true,
      emptyNote: 'Nothing merged yet this sprint.',
    },
  ]);

  authors(): string[] {
    return this.store.config()?.authors ?? [];
  }

  ago(pr: PrRow): string {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(pr.mergedAt ?? pr.updatedAt)) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }
}
