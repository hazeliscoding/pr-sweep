import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BoardStore } from './board.store';
import { OnboardingComponent } from './onboarding.component';

type Theme = 'light' | 'dark';
const THEME_KEY = 'prsweep-theme';

/**
 * Root shell: no branding — the header-left is a title describing what the
 * current page shows (the selected sprint on the board, "Settings" there).
 * Sprint picker, refresh, and the light/dark toggle live here so they're
 * reachable from any page — everything binds to the shared BoardStore.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, OnboardingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app">
      <header class="app-header">
        <h1 class="page-title">{{ pageTitle() }}</h1>
        <div class="header-right">
          @if (store.profiles().length > 1) {
            <label>
              Profile
              <select
                [disabled]="store.loading()"
                (change)="store.switchProfile($any($event.target).value)"
              >
                @for (p of store.profiles(); track p.id) {
                  <option [value]="p.id" [selected]="p.id === store.activeProfile()?.id">{{ p.name }}</option>
                }
              </select>
            </label>
          }
          @if (store.fetchedAgeMin() !== null) {
            <span class="header-status">updated {{ ageLabel(store.fetchedAgeMin()!) }}</span>
          }
          <label>
            From
            <input
              type="date"
              [disabled]="store.loading()"
              [value]="store.range()?.start ?? ''"
              (change)="store.setRange({ start: $any($event.target).value })"
            />
          </label>
          <label>
            To
            <input
              type="date"
              title="Leave empty for an open-ended view (until now)"
              [disabled]="store.loading()"
              [value]="store.range()?.end ?? ''"
              (change)="store.setRange({ end: $any($event.target).value || null })"
            />
          </label>
          <button class="btn-primary" [disabled]="store.loading()" (click)="store.refresh()">
            {{ store.loading() ? 'Sweeping…' : 'Refresh' }}
          </button>
          <button (click)="toggleTheme()" [attr.aria-label]="'Switch to ' + otherTheme() + ' theme'">
            {{ otherTheme() === 'dark' ? 'Dark' : 'Light' }}
          </button>
          <a class="nav-link" routerLink="/board" routerLinkActive="active">Board</a>
          <a class="nav-link" routerLink="/settings" routerLinkActive="active">Settings</a>
        </div>
      </header>

      @if (store.error(); as err) {
        <div class="error-banner">{{ err }}</div>
      }

      <main class="main">
        <router-outlet />
      </main>
      <app-onboarding />
    </div>
  `,
})
export class AppComponent {
  readonly store = inject(BoardStore);

  private readonly url = signal('');
  readonly theme = signal<Theme>(initialTheme());
  readonly otherTheme = computed<Theme>(() => (this.theme() === 'light' ? 'dark' : 'light'));

  readonly pageTitle = computed(() => {
    if (this.url().includes('settings')) return 'Settings';
    const range = this.store.range();
    // Prefix the active profile's name only when there's more than one.
    const profiles = this.store.profiles();
    const prefix = profiles.length > 1 ? `${this.store.activeProfile()?.name} · ` : '';
    if (!range?.start) return `${prefix}Pull requests`;
    return range.end
      ? `${prefix}Pull requests — ${dateLabel(range.start)} to ${dateLabel(range.end)}`
      : `${prefix}Pull requests — since ${dateLabel(range.start)}`;
  });

  constructor() {
    void this.store.init();
    const router = inject(Router);
    this.url.set(router.url);
    router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects);
    });
    effect(() => {
      document.documentElement.dataset['theme'] = this.theme();
      document.title = this.pageTitle();
      localStorage.setItem(THEME_KEY, this.theme());
    });
  }

  toggleTheme(): void {
    this.theme.set(this.otherTheme());
  }

  ageLabel(min: number): string {
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }
}

/** "2026-08-09" → "Aug 9" (with year when it isn't the current one). */
function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/** Stored choice wins; first run follows the OS. */
function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
