import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BoardStore } from './board.store';
import { Sprint } from './models';
import { IconComponent } from './ui/icon.component';

/**
 * What the board covers: a sprint from the profile's schedule, stepped with the
 * arrows (Quorum's TimeRangePicker, adapted to sprints), or a custom From/To
 * range. The main process resolves the period; this only picks one.
 */
@Component({
  selector: 'app-period-picker',
  standalone: true,
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.period(); as p) {
      <div class="period" role="group" aria-label="Board period">
        @if (p.hasSchedule) {
          <!-- Toggle buttons, not radios: each is its own Tab stop, and there are no arrow keys to learn. -->
          <div class="q-seg" role="group" aria-label="Show">
            <button
              class="q-seg__item"
              [attr.aria-pressed]="p.kind === 'sprint'"
              [disabled]="store.loading()"
              (click)="store.setPeriod('current')"
            >
              Sprints
            </button>
            <button
              class="q-seg__item"
              [attr.aria-pressed]="p.kind === 'custom'"
              [disabled]="store.loading()"
              (click)="store.setPeriod('custom')"
            >
              Custom
            </button>
          </div>
        }
        @if (p.kind === 'sprint') {
          <button
            class="q-btn q-btn--ghost q-btn--icon"
            [disabled]="!p.previous || store.loading()"
            [attr.aria-label]="p.previous ? 'Previous sprint: ' + p.previous.name : 'No earlier sprint'"
            (click)="show(p.previous)"
          >
            <q-icon name="chevron-left" />
          </button>
          <span class="period__label" [attr.title]="p.isCurrent ? 'The current sprint' : null">{{ p.label }}</span>
          <button
            class="q-btn q-btn--ghost q-btn--icon"
            [disabled]="!p.next || store.loading()"
            [attr.aria-label]="p.next ? 'Next sprint: ' + p.next.name : 'No later sprint'"
            (click)="show(p.next)"
          >
            <q-icon name="chevron-right" />
          </button>
          @if (!p.isCurrent && p.current) {
            <button class="q-btn q-btn--sm" [disabled]="store.loading()" (click)="store.setPeriod('current')">
              Current
            </button>
          }
        } @else {
          <label class="period__date">
            From
            <input
              class="q-input q-input--mono"
              type="date"
              [disabled]="store.loading()"
              [value]="p.range.start"
              (change)="store.setRange({ start: $any($event.target).value })"
            />
          </label>
          <label class="period__date">
            To
            <input
              class="q-input q-input--mono"
              type="date"
              title="Leave empty for an open-ended view (until now)"
              [disabled]="store.loading()"
              [value]="p.range.end ?? ''"
              (change)="store.setRange({ end: $any($event.target).value || null })"
            />
          </label>
          @if (!p.hasSchedule) {
            <a class="period__setup" routerLink="/settings" fragment="sprints">Set up sprints</a>
          }
        }
      </div>
    }
  `,
})
export class PeriodPickerComponent {
  readonly store = inject(BoardStore);

  /** Stepping to the sprint containing today is "Current", so it keeps rolling over. */
  show(sprint: Sprint | null): void {
    if (!sprint) return;
    const current = this.store.period()?.current;
    this.store.setPeriod(current && current.number === sprint.number ? 'current' : { sprint: sprint.number });
  }
}
