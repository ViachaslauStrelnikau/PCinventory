import { Injectable, inject } from '@angular/core';
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore/lite';
import { InventoryData } from '../core/inventory-data';

export type WebRole = 'ADMIN' | 'USER';

export interface WebUser {
  uid: string;
  email: string;
  displayName: string;
  role: WebRole;
  enabled: boolean;
  pending: boolean;
}

type Profile = { displayName: string; role: WebRole };
type Changes = Profile & { enabled?: boolean; pending?: boolean };

const errorMessages: Record<string, string> = {
  'last-admin': 'Последнего активного администратора нельзя деактивировать или перевести в роль пользователя.',
  'concurrent-update': 'Данные изменились в другой сессии. Обновите список и повторите действие.',
};

export function usersError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (message && Object.hasOwn(errorMessages, message)) return errorMessages[message];
  if (code === 'permission-denied' || code === 'unauthenticated') {
    return 'Для управления пользователями нужен доступ активного администратора.';
  }
  if (code === 'aborted') return errorMessages['concurrent-update'];
  return 'Операция не выполнена. Попробуйте ещё раз.';
}

@Injectable({ providedIn: 'root' })
export class UsersData {
  private readonly inventory = inject(InventoryData);

  async list(): Promise<WebUser[]> {
    const { db } = this.inventory.adminConnection();
    const rows = await getDocs(query(collection(db, 'users'), where('role', 'in', ['ADMIN', 'USER'])));
    return rows.docs.map(row => ({
      uid: row.id, email: row.get('email') ?? '', displayName: row.get('displayName') ?? '',
      role: row.get('role'), enabled: row.get('enabled') === true, pending: row.get('pending') === true,
    }));
  }

  async save(seen: WebUser, profile: Profile, enabled?: boolean): Promise<void> {
    const { db, session } = this.inventory.adminConnection();
    const anchorRef = doc(db, 'settings', 'access');
    const targetRef = doc(db, 'users', seen.uid);
    const changes: Changes = { ...profile, displayName: profile.displayName.trim() };
    if (enabled !== undefined) changes.enabled = enabled;
    if (seen.pending && enabled === true) changes.pending = false;
    const losingAdmin = seen.role === 'ADMIN' && seen.enabled
      && (profile.role !== 'ADMIN' || enabled === false);
    const alternatives = losingAdmin ? (await this.list()).filter(row =>
      row.uid !== seen.uid && row.role === 'ADMIN' && row.enabled) : [];
    await runTransaction(db, async transaction => {
      const [anchor, target] = await Promise.all([transaction.get(anchorRef), transaction.get(targetRef)]);
      if (!target.exists() || seen.role !== target.get('role') || seen.enabled !== target.get('enabled')
          || seen.pending !== (target.get('pending') === true) || seen.displayName !== (target.get('displayName') ?? '')) {
        throw new Error('concurrent-update');
      }
      let anchorUid = anchor.data()?.['adminUid'] ?? session.uid;
      if (losingAdmin && anchorUid === seen.uid) {
        const candidates = await Promise.all(alternatives.map(row => transaction.get(doc(db, 'users', row.uid))));
        const next = candidates.find(candidate => candidate.get('role') === 'ADMIN' && candidate.get('enabled') === true);
        if (!next) throw new Error('last-admin');
        anchorUid = next.id;
      }
      if (!anchor.exists() || anchorUid !== anchor.get('adminUid')) {
        transaction.set(anchorRef, { adminUid: anchorUid });
      }
      transaction.update(targetRef, changes);
    });
  }
}
