import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InventoryData } from '../core/inventory-data';
import { meetsPasswordPolicy, passwordHint, passwordMaxLength, passwordMinLength } from '../core/password-policy';
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
  readonly activeAdmins = computed(() => this.rows().filter(user => user.enabled && user.authAvailable && user.role === 'ADMIN'));
  readonly editor = signal<'create' | 'profile' | 'email' | null>(null);
  readonly selected = signal<WebUser | null>(null);
  readonly confirming = signal<WebUser | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly roleLabels = roleLabels;
  readonly passwordHint = passwordHint;
  readonly passwordMinLength = passwordMinLength;
  readonly passwordMaxLength = passwordMaxLength;
  email = '';
  displayName = '';
  password = '';
  passwordConfirmation = '';
  role: WebRole = 'USER';
  private requestId = '';

  constructor() { void this.load(); }

  async refresh(): Promise<void> {
    this.error.set('');
    this.notice.set('');
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const users = await this.accounts.list();
      this.rows.set(users.sort((a, b) => collator.compare(a.email || a.uid, b.email || b.uid)));
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

  get validPasswordPair(): boolean {
    return meetsPasswordPolicy(this.password) && this.password === this.passwordConfirmation;
  }

  private clearPasswords(): void {
    this.password = '';
    this.passwordConfirmation = '';
  }

  open(mode: 'create' | 'profile' | 'email', user: WebUser | null = null): void {
    this.error.set('');
    this.notice.set('');
    this.confirming.set(null);
    this.selected.set(user);
    this.email = user?.email ?? '';
    this.displayName = user?.displayName ?? '';
    this.role = user?.role ?? 'USER';
    this.clearPasswords();
    this.requestId = mode === 'create' ? crypto.randomUUID() : '';
    this.editor.set(mode);
  }

  close(): void {
    this.editor.set(null);
    this.confirming.set(null);
    this.selected.set(null);
    this.clearPasswords();
    this.error.set('');
  }

  confirmStatus(user: WebUser): void {
    this.close();
    this.notice.set('');
    this.confirming.set(user);
  }

  async save(): Promise<void> {
    if (this.editor() === 'create' && !this.validPasswordPair) return;
    await this.perform(async () => {
      const mode = this.editor();
      const user = this.selected();
      const profile = { displayName: this.displayName, role: this.role };
      if (mode === 'create') {
        await this.accounts.create(profile, this.email, this.password, this.requestId);
        this.close();
        this.notice.set('Учётная запись создана.');
      } else if (mode === 'profile' && user) {
        await this.accounts.update(user.uid, profile);
        if (user.uid === this.data.session()?.uid && this.role !== 'ADMIN') {
          await this.endSession();
          return;
        }
        this.close();
        this.notice.set('Профиль сохранён.');
      } else if (mode === 'email' && user) {
        await this.accounts.changeEmail(user.uid, this.email);
        if (user.uid === this.data.session()?.uid) {
          await this.endSession();
          return;
        }
        this.close();
        this.notice.set('Почта обновлена.');
      }
      await this.load();
    });
  }

  async changeStatus(user: WebUser): Promise<void> {
    await this.perform(async () => {
      await this.accounts.setEnabled(user.uid, !user.enabled);
      if (user.enabled && user.uid === this.data.session()?.uid) {
        await this.endSession();
        return;
      }
      this.close();
      this.notice.set(user.enabled ? 'Доступ отключён.' : 'Доступ восстановлен.');
      await this.load();
    });
  }

  private async endSession(): Promise<void> {
    this.registry.reset();
    try {
      await this.data.logout();
    } finally {
      await this.router.navigateByUrl('/login');
    }
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await action();
    } catch (error) {
      const message = usersError(error);
      if ((error as { message?: string } | null)?.message === 'last-admin') await this.load();
      this.error.set(message);
    } finally {
      this.clearPasswords();
      this.busy.set(false);
    }
  }
}
