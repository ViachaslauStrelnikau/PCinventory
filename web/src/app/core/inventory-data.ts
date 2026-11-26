import { Injectable, computed, inject, signal } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { EmailAuthProvider, connectAuthEmulator, initializeAuth, inMemoryPersistence, reauthenticateWithCredential,
  createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, signOut, updatePassword } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { Timestamp, collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore,
  runTransaction, serverTimestamp, setDoc } from 'firebase/firestore/lite';
import type { DocumentData, Firestore } from 'firebase/firestore/lite';
import type { InventoryLocation } from '../../../../shared/location-directory.mjs';
import { changeDirectory, indexLocation, loadDirectory, resolveCardLocation, touchDirectory, type DirectoryCommand } from './directory-store';
import { readComputer, readReport } from './contracts/inventory-contract';
import type { Assignment, ComputerDocument, ContractTimestamp, Hardware, InventoryReport } from './contracts/inventory-types';
import { meetsPasswordPolicy, passwordHint } from './password-policy';
import { firebaseOptions, localFirebase, localFirestoreHost, localFirestorePort } from './firebase-environment';

export const optionalFields = { inventoryNumber: 'Инвентарный №', employeeName: 'ФИО сотрудника',
  department: 'Подразделение', comment: 'Примечание' } as const;
export type OptionalField = keyof typeof optionalFields;
export const optionalKeys = Object.keys(optionalFields) as OptionalField[];

export type Entry = { hardware: Hardware; assignment: Assignment };
type Session = { uid: string; email: string; role: 'ADMIN' | 'USER' };

export function editorEntry(card: ComputerDocument): Entry {
  const { building, floor, room, inventoryNumber, employeeName, department, comment, deviceId,
    status, lastReportId, lastInventoryAt, assignmentUpdatedAt, assignmentUpdatedBy, ...hardware } = card;
  return { hardware, assignment: { building, floor, room, inventoryNumber, employeeName, department, comment } };
}

export function effective(report: InventoryReport): Entry {
  return report.correction ?? report;
}

export function isStale(report: InventoryReport, card: ComputerDocument | null): boolean {
  if (!card?.lastInventoryAt || !card.lastReportId) return false;
  const comparison = compareTimes(report.submittedAt, card.lastInventoryAt);
  return comparison < 0 || (comparison === 0 && report.reportId <= card.lastReportId);
}

function compareTimes(a: ContractTimestamp, b: ContractTimestamp): number {
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
}

export class InventoryError extends Error {}

export function messageFor(error: unknown): string {
  if (error instanceof InventoryError) return error.message;
  if (error instanceof TypeError && error.message.startsWith('Invalid inventory data')) {
    const field = error.message.split(': ').at(-1);
    const fields: Record<string, string> = {
      'RAM slot counts': 'Проверьте число занятых и свободных слотов ОЗУ.',
      'complete RAM topology': 'Для полной схемы ОЗУ укажите уникальные обозначения и состояние всех слотов.',
      'CPU counts': 'Количество ядер не может превышать количество потоков.',
      'networkMode': 'Проверьте режимы сетевых адаптеров.',
    };
    return fields[field ?? ''] ?? 'Проверьте обязательные поля, диапазоны чисел и IPv4-адреса.';
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === 'permission-denied') return 'Доступ запрещён. Проверьте права учётной записи.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Проверьте почту и пароль.';
  }
  if (code === 'auth/email-already-in-use') return 'Учётная запись уже существует. Войдите с этой почтой.';
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return passwordHint;
  if (code === 'auth/invalid-email') return 'Проверьте адрес электронной почты.';
  if (code === 'auth/too-many-requests') return 'Слишком много попыток. Попробуйте позже.';
  if (code === 'unavailable' || code === 'auth/network-request-failed') return 'Нет связи с Firebase.';
  return 'Операция не выполнена. Попробуйте снова.';
}

function decode(value: unknown): unknown {
  if (value instanceof Timestamp) return packTime(value);
  if (Array.isArray(value)) return value.map(decode);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  }
  return value;
}

function packTime(value: Timestamp): ContractTimestamp {
  return { seconds: value.seconds, nanoseconds: value.nanoseconds };
}

function timestamp(value: ContractTimestamp | null): Timestamp | null {
  return value === null ? null : new Timestamp(value.seconds, value.nanoseconds);
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function sameVersion(current: unknown, seen: unknown): void {
  if (fingerprint(current) !== fingerprint(seen)) {
    throw new InventoryError('Данные изменились. Обновите страницу и повторите проверку.');
  }
}

function requiredAssignment(value: Assignment, defaults?: Required<Assignment>): Required<Assignment> {
  return { building: value.building, floor: value.floor, room: value.room,
    inventoryNumber: value.inventoryNumber ?? defaults?.inventoryNumber ?? '',
    employeeName: value.employeeName ?? defaults?.employeeName ?? '',
    department: value.department ?? defaults?.department ?? '',
    comment: value.comment ?? defaults?.comment ?? '' };
}

function directoryError(error: unknown): never {
  if (error instanceof Error && error.message === 'location-deleted') {
    throw new InventoryError('Расположение удалено. Укажите актуальные здание, этаж и кабинет.');
  }
  if (error instanceof Error && error.message === 'location-renamed') {
    throw new InventoryError('Расположение переименовано. Укажите актуальные здание, этаж и кабинет.');
  }
  throw error;
}

@Injectable({ providedIn: 'root' })
export class InventoryData {
  private readonly db: Firestore | null = null;
  private readonly auth: Auth | null = null;
  readonly session = signal<Session | null>(null);
  readonly admin = computed(() => this.session()?.role === 'ADMIN');
  readonly cards = signal<ComputerDocument[]>([]);
  readonly locations = signal<InventoryLocation[]>([]);
  readonly locationsError = signal('');
  readonly reports = signal<InventoryReport[]>([]);
  readonly invalidReports = signal<string[]>([]);
  readonly pendingCount = computed(() => this.reports().filter(report => report.status === 'PENDING').length);
  readonly cardsLoading = signal(false);
  readonly cardsError = signal('');
  readonly cardsLoaded = signal(false);
  readonly reportsError = signal('');
  readonly reportsLoading = signal(false);
  private readonly firebase = inject(firebaseOptions);
  readonly configured = this.firebase !== null;
  private readonly originalCards = new WeakMap<ComputerDocument, ComputerDocument>();
  private cardsRequest = 0;
  private reportsRequest = 0;

  constructor() {
    if (!this.firebase) return;
    const app = initializeApp(this.firebase);
    this.auth = initializeAuth(app, { persistence: inMemoryPersistence });
    this.db = getFirestore(app);
    if (localFirebase) {
      connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(this.db, localFirestoreHost, localFirestorePort);
    }
  }

  async register(email: string, password: string): Promise<void> {
    if (!this.auth) throw new InventoryError('Подключение к Firebase не настроено.');
    if (!meetsPasswordPolicy(password)) throw new InventoryError(passwordHint);
    const { user } = await createUserWithEmailAndPassword(this.auth, email.trim(), password);
    try {
      await sendEmailVerification(user);
    } catch {
      throw new InventoryError('Учётная запись создана. Войдите с этим паролем, чтобы повторно отправить письмо.');
    } finally {
      await signOut(this.auth);
    }
  }

  async login(email: string, password: string): Promise<void> {
    if (!this.auth || !this.db) throw new InventoryError('Подключение к Firebase не настроено.');
    const { user } = await signInWithEmailAndPassword(this.auth, email.trim(), password);
    try {
      const profileRef = doc(this.db, 'users', user.uid);
      const access = (await getDoc(profileRef)).data();
      if (!access) {
        if (!user.emailVerified) {
          await sendEmailVerification(user);
          throw new InventoryError('Подтвердите почту по ссылке из письма и войдите снова.');
        }
        await runTransaction(this.db, async transaction => {
          if (!(await transaction.get(profileRef)).exists()) {
            transaction.set(profileRef, { email: user.email, role: 'USER', enabled: false, pending: true });
          }
        });
        throw new InventoryError('Запрос на доступ отправлен. После одобрения администратором войдите снова.');
      }
      if (access['pending'] === true) throw new InventoryError('Запрос ожидает одобрения администратором.');
      const role = access['role'];
      if (access?.['enabled'] !== true || (role !== 'ADMIN' && role !== 'USER')) {
        throw new InventoryError('У этой учётной записи нет доступа к веб-интерфейсу.');
      }
      if (user.emailVerified && user.email && access['email'] !== user.email) {
        await runTransaction(this.db, async transaction => {
          const latest = (await transaction.get(profileRef)).data();
          if (latest && latest['email'] !== user.email) transaction.update(profileRef, { email: user.email });
        });
      }
      this.session.set({ uid: user.uid, email: user.email ?? email.trim(), role });
      if (role === 'ADMIN') void this.refreshReports();
    } catch (error) {
      await signOut(this.auth);
      throw error;
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (!meetsPasswordPolicy(newPassword)) throw new InventoryError(passwordHint);
    const { db, session } = this.connection();
    const user = this.auth?.currentUser;
    if (!user?.email || user.uid !== session.uid) throw new InventoryError('Войдите в приложение заново.');
    const access = (await getDoc(doc(db, 'users', session.uid))).data();
    if (access?.['enabled'] !== true || !['ADMIN', 'USER'].includes(access['role'])) {
      throw new InventoryError('У этой учётной записи нет доступа к веб-интерфейсу.');
    }
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        throw new InventoryError('Текущий пароль указан неверно.');
      }
      if (code === 'auth/too-many-requests') throw new InventoryError('Слишком много попыток. Попробуйте позже.');
      throw error;
    }
    if (this.auth?.currentUser?.uid !== user.uid || this.session()?.uid !== user.uid) {
      throw new InventoryError('Войдите в приложение заново.');
    }
    try {
      await updatePassword(user, newPassword);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
        throw new InventoryError('Сервис отклонил новый пароль. Проверьте правила создания пароля.');
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    this.session.set(null);
    this.cardsRequest++;
    this.reportsRequest++;
    this.cards.set([]);
    this.locations.set([]);
    this.locationsError.set('');
    this.reports.set([]);
    this.invalidReports.set([]);
    this.cardsError.set('');
    this.cardsLoaded.set(false);
    this.reportsError.set('');
    this.cardsLoading.set(false);
    this.reportsLoading.set(false);
    if (this.auth) await signOut(this.auth);
  }

  private connection(): { db: Firestore; session: Session } {
    const session = this.session();
    if (!this.db || !session) throw new InventoryError('Войдите в приложение.');
    return { db: this.db, session };
  }

  adminConnection(): { db: Firestore; session: Session } {
    const connection = this.connection();
    if (connection.session.role !== 'ADMIN') throw new InventoryError('Нужны права администратора.');
    return connection;
  }

  adminBackupSource() {
    const { session } = this.adminConnection();
    const project = this.firebase?.projectId;
    if (!project) throw new InventoryError('Проект Firebase не настроен.');
    return {
      project,
      base: localFirebase ? 'http://' + localFirestoreHost + ':' + localFirestorePort : undefined,
      getToken: () => {
        const { session: current } = this.adminConnection();
        const user = this.auth?.currentUser;
        if (!user || current.uid !== session.uid || user.uid !== session.uid) {
          throw new InventoryError('Войдите в приложение заново.');
        }
        return user.getIdToken();
      },
    };
  }

  private presentCard(card: ComputerDocument, currentLocation: InventoryLocation): ComputerDocument {
    const presented = { ...card, ...currentLocation };
    this.originalCards.set(presented, card);
    return presented;
  }

  async updateDirectory(command: DirectoryCommand): Promise<void> {
    const { db } = this.adminConnection();
    await changeDirectory(db, command);
    await this.refreshCards();
  }

  async refreshCards(): Promise<void> {
    const { db } = this.connection();
    const request = ++this.cardsRequest;
    this.cardsLoading.set(true);
    this.cardsError.set('');
    this.locationsError.set('');
    try {
      const [snapshots, directory] = await Promise.all([
        getDocs(collection(db, 'computers')),
        loadDirectory(db).catch(() => null),
      ]);
      const records = snapshots.docs.map(item => {
        const card = readComputer(decode(item.data()));
        if (card.deviceId !== item.id) throw new InventoryError('Обнаружена карточка с неверным идентификатором.');
        return card;
      });
      if (request !== this.cardsRequest) return;
      this.cards.set(directory ? records.map(card => this.presentCard(card, directory.resolve(card))) : records);
      this.locations.set(directory?.locations ?? []);
      if (!directory) this.locationsError.set('Не удалось загрузить справочник расположений.');
      this.cardsLoaded.set(true);
    } catch (error) {
      if (request !== this.cardsRequest) return;
      this.cards.set([]);
      this.locations.set([]);
      this.cardsLoaded.set(false);
      this.cardsError.set(messageFor(error));
    } finally {
      if (request === this.cardsRequest) this.cardsLoading.set(false);
    }
  }

  async refreshReports(): Promise<void> {
    const { db } = this.adminConnection();
    const request = ++this.reportsRequest;
    this.reportsLoading.set(true);
    this.reportsError.set('');
    try {
      const snapshots = await getDocs(collection(db, 'inventoryReports'));
      const reports: InventoryReport[] = [];
      const invalid: string[] = [];
      for (const item of snapshots.docs) {
        try {
          const report = readReport(decode(item.data()));
          if (report.reportId === item.id) reports.push(report);
          else invalid.push(item.id);
        } catch {
          invalid.push(item.id);
        }
      }
      if (request !== this.reportsRequest) return;
      this.reports.set(reports.sort((a, b) => compareTimes(b.submittedAt, a.submittedAt) || b.reportId.localeCompare(a.reportId)));
      this.invalidReports.set(invalid);
    } catch (error) {
      if (request !== this.reportsRequest) return;
      this.reports.set([]);
      this.invalidReports.set([]);
      this.reportsError.set(messageFor(error));
    } finally {
      if (request === this.reportsRequest) this.reportsLoading.set(false);
    }
  }

  async loadCard(id: string): Promise<ComputerDocument | null> {
    const { db } = this.connection();
    const snapshot = await getDoc(doc(db, 'computers', id));
    if (!snapshot.exists()) return null;
    const card = readComputer(decode(snapshot.data()));
    if (card.deviceId !== id) throw new InventoryError('Обнаружена карточка с неверным идентификатором.');
    const currentLocation = await resolveCardLocation(db, card);
    return this.presentCard(card, currentLocation);
  }

  async createCard(entry: Entry): Promise<string> {
    const { db, session } = this.adminConnection();
    const id = 'manual-' + crypto.randomUUID();
    const card = readComputer({ ...entry.hardware, ...requiredAssignment(entry.assignment), deviceId: id,
      identitySource: 'MANUAL', agentVersion: 'manual', status: 'ACTIVE', lastReportId: null, lastInventoryAt: null,
      assignmentUpdatedAt: packTime(Timestamp.now()), assignmentUpdatedBy: session.uid });
    // The transaction makes a UUID collision a failure rather than an overwrite.
    await runTransaction(db, async transaction => {
      const ref = doc(db, 'computers', id);
      if ((await transaction.get(ref)).exists()) throw new InventoryError('Идентификатор занят. Повторите сохранение.');
      await indexLocation(transaction, db, card).catch(directoryError);
      transaction.set(ref, { ...card, assignmentUpdatedAt: serverTimestamp() });
    });
    await this.refreshCards();
    return id;
  }

  async editCard(seen: ComputerDocument, entry: Entry): Promise<void> {
    const { db, session } = this.adminConnection();
    const ref = doc(db, 'computers', seen.deviceId);
    await runTransaction(db, async transaction => {
      sameVersion(decode((await transaction.get(ref)).data()), this.originalCards.get(seen) ?? seen);
      const updates = { ...entry.hardware, ...requiredAssignment(entry.assignment) };
      readComputer({ ...seen, ...updates });
      await indexLocation(transaction, db, entry.assignment).catch(directoryError);
      transaction.update(ref, { ...updates, assignmentUpdatedAt: serverTimestamp(), assignmentUpdatedBy: session.uid });
    });
    await this.refreshCards();
  }

  async archive(seen: ComputerDocument, status: 'ACTIVE' | 'RETIRED'): Promise<void> {
    const { db, session } = this.adminConnection();
    const ref = doc(db, 'computers', seen.deviceId);
    await runTransaction(db, async transaction => {
      sameVersion(decode((await transaction.get(ref)).data()), this.originalCards.get(seen) ?? seen);
      transaction.update(ref, { status, assignmentUpdatedAt: serverTimestamp(), assignmentUpdatedBy: session.uid });
    });
    await this.refreshCards();
  }

  async purge(seen: ComputerDocument): Promise<void> {
    const { db } = this.adminConnection();
    const ref = doc(db, 'computers', seen.deviceId);
    await runTransaction(db, async transaction => {
      sameVersion(decode((await transaction.get(ref)).data()), this.originalCards.get(seen) ?? seen);
      if (seen.status !== 'RETIRED') throw new InventoryError('Сначала архивируйте карточку.');
      transaction.delete(ref);
      touchDirectory(transaction, db);
    });
    await this.refreshCards();
  }

  async saveCorrection(seen: InventoryReport, entry: Entry): Promise<void> {
    const { db, session } = this.adminConnection();
    const ref = doc(db, 'inventoryReports', seen.reportId);
    await runTransaction(db, async transaction => {
      sameVersion(decode((await transaction.get(ref)).data()), seen);
      if (seen.status !== 'PENDING') throw new InventoryError('Отчёт уже обработан.');
      const correction = { ...entry, updatedAt: seen.submittedAt, updatedBy: session.uid };
      readReport({ ...seen, correction });
      transaction.update(ref, { correction: { ...correction, updatedAt: serverTimestamp() } });
    });
    await this.refreshReports();
  }

  async review(seen: InventoryReport, seenCard: ComputerDocument | null, selected: ReadonlySet<OptionalField>,
      status: 'ACCEPTED' | 'REJECTED'): Promise<void> {
    const { db, session } = this.adminConnection();
    const location = effective(seen).assignment;
    await runTransaction(db, async transaction => {
      const ref = doc(db, 'inventoryReports', seen.reportId);
      sameVersion(decode((await transaction.get(ref)).data()), seen);
      if (seen.status !== 'PENDING') throw new InventoryError('Отчёт уже обработан.');
      if (status === 'ACCEPTED') {
        const cardRef = doc(db, 'computers', seen.deviceId);
        const snapshot = await transaction.get(cardRef);
        const original = seenCard ? this.originalCards.get(seenCard) ?? seenCard : null;
        sameVersion(snapshot.exists() ? decode(snapshot.data()) : null, original);
        if (isStale(seen, seenCard)) throw new InventoryError('Отчёт устарел. Его можно отклонить.');
        await indexLocation(transaction, db, location).catch(directoryError);
        transaction.set(cardRef, this.acceptedCard(seen, original, selected, session.uid));
      }
      transaction.update(ref, { status, reviewedAt: serverTimestamp(), reviewedBy: session.uid });
    });
    await Promise.all([this.refreshReports(), this.refreshCards()]);
  }

  private acceptedCard(report: InventoryReport, previous: ComputerDocument | null,
      selected: ReadonlySet<OptionalField>, uid: string): DocumentData {
    const proposed = effective(report);
    const assignment = requiredAssignment(proposed.assignment, previous ?? undefined);
    for (const key of optionalKeys) {
      if (!selected.has(key)) assignment[key] = previous?.[key] ?? '';
    }
    const changed = previous === null
      || Object.entries(assignment).some(([key, value]) => previous[key as keyof Assignment] !== value);
    const audit = changed ? packTime(Timestamp.now()) : previous.assignmentUpdatedAt;
    const card = readComputer({ ...proposed.hardware, ...assignment, deviceId: report.deviceId,
      status: previous?.status ?? 'ACTIVE', lastReportId: report.reportId, lastInventoryAt: report.submittedAt,
      assignmentUpdatedAt: audit, assignmentUpdatedBy: changed ? uid : previous.assignmentUpdatedBy });
    return { ...card, lastInventoryAt: timestamp(card.lastInventoryAt),
      assignmentUpdatedAt: changed ? serverTimestamp() : timestamp(audit) };
  }

  async intake(): Promise<boolean> {
    const { db } = this.adminConnection();
    return (await getDoc(doc(db, 'settings', 'inventory'))).data()?.['acceptingReports'] === true;
  }

  async setIntake(open: boolean): Promise<void> {
    const { db } = this.adminConnection();
    await setDoc(doc(db, 'settings', 'inventory'), { acceptingReports: open });
  }
}
