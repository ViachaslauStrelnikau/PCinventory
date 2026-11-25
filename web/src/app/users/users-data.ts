import { Injectable, inject } from '@angular/core';
import { LocalFunctions } from '../core/local-functions';
import { passwordHint } from '../core/password-policy';

export type WebRole = 'ADMIN' | 'USER';

export interface WebUser {
  uid: string;
  email: string;
  displayName: string;
  role: WebRole;
  enabled: boolean;
  authAvailable: boolean;
}

type Profile = { displayName: string; role: WebRole };
type Command = { action: 'list' }
  | ({ action: 'create'; requestId: string; email: string; password: string } & Profile)
  | ({ action: 'update'; uid: string } & Profile)
  | { action: 'changeEmail'; uid: string; email: string }
  | { action: 'setEnabled'; uid: string; enabled: boolean };

const errorMessages: Record<string, string> = {
  'last-admin': 'Последнего активного администратора нельзя деактивировать или перевести в роль пользователя.',
  'invalid-email': 'Введите действительный адрес электронной почты.',
  'email-in-use': 'Учётная запись с такой почтой уже существует.',
  'invalid-password-policy': passwordHint,
  'invalid-profile': 'Проверьте имя и роль пользователя.',
  'web-user-not-found': 'Учётная запись недоступна. Обновите список.',
  'auth-user-not-found': 'Для этой учётной записи отсутствует запись в Firebase Authentication.',
  'concurrent-update': 'Данные изменились в другой сессии. Обновите список и повторите действие.',
};

export function usersError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (message && Object.hasOwn(errorMessages, message)) return errorMessages[message];
  if (code === 'functions/permission-denied' || code === 'functions/unauthenticated') {
    return 'Для управления пользователями нужен доступ активного администратора.';
  }
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return 'Сервис управления пользователями недоступен. Попробуйте ещё раз.';
  }
  return 'Операция не выполнена. Попробуйте ещё раз.';
}

@Injectable({ providedIn: 'root' })
export class UsersData {
  private readonly functions = inject(LocalFunctions);

  private invoke<T>(command: Command): Promise<T> {
    return this.functions.invoke<Command, T>('manageWebUsers', command);
  }

  list(): Promise<WebUser[]> { return this.invoke({ action: 'list' }); }

  async create(profile: Profile, email: string, password: string, requestId: string): Promise<void> {
    await this.invoke({ action: 'create', ...profile, email, password, requestId });
  }

  async update(uid: string, profile: Profile): Promise<void> {
    await this.invoke({ action: 'update', uid, ...profile });
  }

  async setEnabled(uid: string, enabled: boolean): Promise<void> {
    await this.invoke({ action: 'setEnabled', uid, enabled });
  }

  async changeEmail(uid: string, email: string): Promise<void> {
    await this.invoke({ action: 'changeEmail', uid, email });
  }
}
