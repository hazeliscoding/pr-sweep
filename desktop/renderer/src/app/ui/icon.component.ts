import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconName, ICONS } from './icons';

/**
 * A Lucide icon drawn from vendored element data (see icons.ts). Decorative by
 * default: the button or text next to it carries the meaning, so it's hidden
 * from assistive tech. Quorum draws icons at 14px with a 1.75px stroke.
 */
@Component({
  selector: 'q-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'q-icon', 'aria-hidden': 'true' },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
    >
      @for (s of shapes(); track $index) {
        @switch (s[0]) {
          @case ('path') {
            <svg:path [attr.d]="s[1]['d']" />
          }
          @case ('circle') {
            <svg:circle [attr.cx]="s[1]['cx']" [attr.cy]="s[1]['cy']" [attr.r]="s[1]['r']" [attr.fill]="s[1]['fill'] ?? null" />
          }
          @case ('line') {
            <svg:line [attr.x1]="s[1]['x1']" [attr.y1]="s[1]['y1']" [attr.x2]="s[1]['x2']" [attr.y2]="s[1]['y2']" />
          }
          @case ('polyline') {
            <svg:polyline [attr.points]="s[1]['points']" />
          }
          @case ('polygon') {
            <svg:polygon [attr.points]="s[1]['points']" />
          }
          @case ('rect') {
            <svg:rect
              [attr.x]="s[1]['x']"
              [attr.y]="s[1]['y']"
              [attr.width]="s[1]['width']"
              [attr.height]="s[1]['height']"
              [attr.rx]="s[1]['rx'] ?? null"
              [attr.ry]="s[1]['ry'] ?? null"
            />
          }
          @case ('ellipse') {
            <svg:ellipse [attr.cx]="s[1]['cx']" [attr.cy]="s[1]['cy']" [attr.rx]="s[1]['rx']" [attr.ry]="s[1]['ry']" />
          }
        }
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(14);
  readonly stroke = input(1.75);
  readonly shapes = computed(() => ICONS[this.name()]);
}
