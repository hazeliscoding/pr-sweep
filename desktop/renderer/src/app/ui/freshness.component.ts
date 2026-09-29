import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type FreshnessState = 'updated' | 'updating' | 'delayed' | 'lost';

const LABEL: Record<FreshnessState, string> = {
  updated: 'Updated',
  updating: 'Updating',
  delayed: 'Delayed',
  lost: 'Refresh failed',
};

/**
 * Quorum's Freshness: whether the board is current. A dot (shape and color)
 * plus a word, never color alone; the age is evidence, so it's mono.
 */
@Component({
  selector: 'q-freshness',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="q-fresh" role="status" [attr.title]="title()">
      <span class="q-dot q-dot--{{ tone() }}" [class.q-dot--pulse]="state() === 'updating'"></span>
      {{ label() }}
      @if (age(); as a) {
        <span class="q-fresh__age">{{ a }}</span>
      }
    </span>
  `,
})
export class FreshnessComponent {
  readonly state = input.required<FreshnessState>();
  /** "2m ago"; null while nothing has been fetched yet. */
  readonly age = input<string | null>(null);
  readonly title = input<string | null>(null);

  label(): string {
    return LABEL[this.state()];
  }

  tone(): string {
    return { updated: 'healthy', updating: 'running', delayed: 'warning', lost: 'critical' }[this.state()];
  }
}
