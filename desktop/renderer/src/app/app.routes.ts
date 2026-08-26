import { Routes } from '@angular/router';
import { BoardComponent } from './pages/board.component';
import { SettingsComponent } from './pages/settings.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'board' },
  { path: 'board', component: BoardComponent },
  { path: 'settings', component: SettingsComponent },
];
