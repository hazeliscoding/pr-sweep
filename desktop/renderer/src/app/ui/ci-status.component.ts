import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PrRow } from '../models';

/**
 * The latest commit's check rollup as a dot and a word. No cell when a PR has
 * no checks. Running pulses; under reduced motion the ring holds still.
 */
@Component({
  selector: 'q-ci',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('success') {
        <span class="q-ci q-ci--pass" title="The latest commit's checks passed">
          <span class="q-dot q-dot--healthy" aria-hidden="true"></span>Pass
        </span>
      }
      @case ('failure') {
        <span class="q-ci q-ci--fail" title="The latest commit's checks failed">
          <span class="q-dot q-dot--critical" aria-hidden="true"></span>Fail
        </span>
      }
      @case ('pending') {
        <span class="q-ci q-ci--running" title="The latest commit's checks are still running">
          <span class="q-dot q-dot--running q-dot--pulse" aria-hidden="true"></span>Running
        </span>
      }
    }
  `,
})
export class CiStatusComponent {
  readonly state = input<PrRow['ci']>(null);
}
