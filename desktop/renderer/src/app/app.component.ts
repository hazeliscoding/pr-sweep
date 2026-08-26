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
          @if (store.fetchedAgeMin() !== null) {
            <span class="header-status">updated {{ ageLabel(store.fetchedAgeMin()!) }}</span>
          }
          <label>
            Sprint
            <select
              [disabled]="store.loading()"
              (change)="store.selectSprint($any($event.target).value)"
            >
              <!-- [selected] per option, not [value] on the select: the sprint list
                   arrives async, and a value applied before options exist is lost. -->
              @for (s of store.sprints(); track s.id) {
                <option [value]="s.id" [selected]="s.id === store.sprint()?.id">{{ s.name }}</option>
              }
            </select>
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
    const sprint = this.store.sprint();
    return sprint ? `Pull requests — ${sprint.name}` : 'Pull requests';
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

/** Stored choice wins; first run follows the OS. */
function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
