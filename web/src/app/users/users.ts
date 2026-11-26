import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InventoryData } from '../core/inventory-data';
import { RegistryState, collator } from '../registry/registry-state';
import { UsersData, usersError, type WebRole, type WebUser } from './users-data';

const roleLabels: Record<WebRole, string> = { ADMIN: 'Администратор', USER: 'Пользователь' };

@Component({ imports: [FormsModule], templateUrl: './users.html' })
export class Users {
  private readonly accounts = inject(UsersData);
  readonly data = inject(InventoryData);
  private readonly router = inject(Router);
  private readonly registry = inject(RegistryState);
  readonly rows = signal<WebUser[]>([]);
  readonly activeAdmins = computed(() => this.rows().filter(user => user.enabled && user.role === 'ADMIN'));
  readonly selected = signal<WebUser | null>(null);
  readonly confirming = signal<WebUser | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly roleLabels = roleLabels;
  displayName = '';
  role: WebRole = 'USER';

  constructor() { void this.refresh(); }

  async refresh(): Promise<void> {
    this.error.set('');
    this.notice.set('');
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const users = await this.accounts.list();
      this.rows.set(users.sort((a, b) => Number(b.pending) - Number(a.pending)
        || collator.compare(a.email || a.uid, b.email || b.uid)));
    } catch (error) {
      this.rows.set([]);
      this.error.set(usersError(error));
    } finally {
      this.loading.set(false);
    }
  }

  lastAdmin(user: WebUser): boolean {
    const admins = this.activeAdmins();
    return admins.length === 1 && admins[0].uid === user.uid;
  }

  open(user: WebUser): void {
    this.close();
    this.notice.set('');
    this.selected.set(user);
    this.displayName = user.displayName;
    this.role = user.role;
  }

  close(): void {
    this.selected.set(null);
    this.confirming.set(null);
    this.error.set('');
  }

  confirmStatus(user: WebUser): void {
    this.close();
    this.notice.set('');
    this.confirming.set(user);
  }

  async save(): Promise<void> {
    const user = this.selected();
    if (!user) return;
    await this.perform(user, { displayName: this.displayName, role: this.role },
      user.pending ? true : undefined, user.pending ? 'Запрос одобрен.' : 'Профиль сохранён.');
  }

  async changeStatus(user: WebUser): Promise<void> {
    await this.perform(user, { displayName: user.displayName, role: user.role }, !user.enabled,
      user.enabled ? 'Доступ отключён.' : 'Доступ восстановлен.');
  }

  private async perform(user: WebUser, profile: { displayName: string; role: WebRole },
      enabled: boolean | undefined, success: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.accounts.save(user, profile, enabled);
      if (user.uid === this.data.session()?.uid && (profile.role !== 'ADMIN' || enabled === false)) {
        this.registry.reset();
        try {
          await this.data.logout();
        } finally {
          await this.router.navigateByUrl('/login');
        }
        return;
      }
      this.close();
      this.notice.set(success);
      await this.load();
    } catch (error) {
      this.error.set(usersError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
