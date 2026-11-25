import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn, Routes } from '@angular/router';
import { InventoryData } from './core/inventory-data';
import { Login } from './login';

const signedIn: CanActivateFn = () => inject(InventoryData).session() ? true : inject(Router).parseUrl('/login');
const admin: CanActivateFn = () => {
  const data = inject(InventoryData);
  return data.admin() ? true : inject(Router).parseUrl(data.session() ? '/computers' : '/login');
};

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [() => inject(InventoryData).session() ? inject(Router).parseUrl('/computers') : true] },
  { path: 'computers', title: 'Реестр · Computer Inventory', canActivate: [signedIn],
    loadComponent: () => import('./registry/registry').then(module => module.Registry) },
  { path: 'computers/new', title: 'Новая карточка · Computer Inventory', canActivate: [admin],
    loadComponent: () => import('./registry/card').then(module => module.Card) },
  { path: 'computers/:id', title: 'Карточка ПК · Computer Inventory', canActivate: [signedIn],
    loadComponent: () => import('./registry/card').then(module => module.Card) },
  { path: 'reports', title: 'Входящие отчёты · Computer Inventory', canActivate: [admin],
    loadComponent: () => import('./reports/reports').then(module => module.Reports) },
  { path: 'statistics', title: 'Статистика · Computer Inventory', canActivate: [signedIn],
    loadComponent: () => import('./statistics').then(module => module.Statistics) },
  { path: 'users', title: 'Пользователи · Computer Inventory', canActivate: [admin],
    loadComponent: () => import('./users/users').then(module => module.Users) },
  { path: 'settings', title: 'Настройки · Computer Inventory', canActivate: [admin],
    loadComponent: () => import('./settings').then(module => module.Settings) },
  { path: '', pathMatch: 'full', redirectTo: 'computers' },
  { path: '**', redirectTo: 'computers' },
];
