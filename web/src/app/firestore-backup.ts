import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { InventoryData } from './core/inventory-data';
import { firebaseOptions } from './core/firebase-environment';
import { authorizeRestore, loadGoogleOAuth, type GoogleOAuth, type RestoreAuthorization } from './core/google-restore-auth';
import { counts, createBackup, createFirestore, decodeBackup, encodeBackup, planRestore, restoreBackup,
  validProjectId, type Backup, type BackupCollection, type RestorePlan } from '../../../shared/firestore-backup.mjs';

const collections: { key: BackupCollection; label: string }[] = [
  { key: 'computers', label: 'Карточки ПК' },
  { key: 'inventoryReports', label: 'Отчёты' },
  { key: 'locations', label: 'Расположения' },
  { key: 'locationRenames', label: 'Прежние названия' },
];

@Component({
  selector: 'app-firestore-backup',
  templateUrl: './firestore-backup.html',
})
export class FirestoreBackup {
  private readonly inventory = inject(InventoryData);
  private readonly config = inject(firebaseOptions);
  private readonly lifetime = new AbortController();
  private authorization: RestoreAuthorization | undefined;
  private readonly google = signal<GoogleOAuth | null>(null);
  private readonly clientId = this.config?.restoreOAuthClientId;

  readonly busy = signal(false);
  readonly loadingGoogle = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly selected = signal<{ name: string; backup: Backup } | null>(null);
  readonly target = signal('');
  readonly plan = signal<RestorePlan | null>(null);
  readonly collections = collections;
  readonly googleConfigured = Boolean(this.clientId);
  readonly googleReady = computed(() => this.google() !== null);
  readonly totals = computed(() => {
    const selected = this.selected();
    return selected ? counts(selected.backup.inventory) : null;
  });
  readonly targetError = computed(() => {
    const id = this.target();
    if (!id) return '';
    if (!validProjectId(id) || id.startsWith('demo-')) return 'Укажите действительный Project ID облачного проекта.';
    if (id === this.config?.projectId || id === this.selected()?.backup.sourceProject) {
      return 'Для восстановления выберите отдельный проект.';
    }
    return '';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.authorization = undefined;
      this.lifetime.abort();
    });
  }

  async download(): Promise<void> {
    await this.perform(async () => {
      const db = createFirestore({ ...this.inventory.adminBackupSource(), signal: this.lifetime.signal });
      const backup = await createBackup(db);
      const content = await encodeBackup(backup);
      if (this.lifetime.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pcinventory-' + backup.sourceProject + '-' + backup.readTime.slice(0, 10) + '.pcinventory-backup.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.message.set('Резервная копия готова к скачиванию. Откройте загрузки браузера, чтобы найти файл.');
    });
  }

  async selectFile(input: HTMLInputElement): Promise<void> {
    if (this.busy()) return;
    const file = input.files?.[0];
    input.value = '';
    this.selected.set(null);
    this.clearPlan();
    if (!file) return;

    await this.perform(async () => {
      const backup = await decodeBackup(await file.text());
      this.selected.set({ name: file.name, backup });
      if (this.clientId && !this.google()) void this.prepareGoogle();
    });
  }

  changeTarget(input: HTMLInputElement): void {
    if (this.busy()) return;
    const target = input.value.trim();
    if (this.target() === target) return;
    this.target.set(target);
    this.clearPlan();
    this.error.set('');
    this.message.set('');
  }

  async prepareGoogle(): Promise<void> {
    if (!this.clientId || this.google() || this.loadingGoogle()) return;
    this.loadingGoogle.set(true);
    this.error.set('');
    try {
      this.google.set(await loadGoogleOAuth());
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Вход Google недоступен.');
    } finally {
      this.loadingGoogle.set(false);
    }
  }

  async preview(): Promise<void> {
    const file = this.selected();
    const google = this.google();
    const clientId = this.clientId;
    if (this.busy() || !file || !google || !clientId || !this.target() || this.targetError()) return;
    this.clearPlan();
    await this.perform(async () => {
      this.inventory.adminConnection();
      const authorization = await authorizeRestore(google, clientId);
      this.lifetime.signal.throwIfAborted();
      this.authorization = authorization;
      try {
        const plan = await planRestore(this.targetDatabase(), file.backup);
        this.plan.set(plan);
        if (plan.missingCount === 0) {
          this.authorization = undefined;
          this.message.set('Все документы из копии уже есть в целевом проекте.');
        }
      } catch (error) {
        this.clearPlan();
        throw error;
      }
    });
  }

  async restore(): Promise<void> {
    const file = this.selected();
    if (!file || !this.plan()?.missingCount || this.targetError()) return;
    await this.perform(async () => {
      try {
        this.inventory.adminConnection();
        const target = this.target();
        const result = await restoreBackup(this.targetDatabase(), file.backup);
        this.message.set('Восстановление проверено. Проект ' + target + ', создано документов ' + result.written + '.');
      } finally {
        this.clearPlan();
      }
    });
  }

  private targetDatabase() {
    return createFirestore({ project: this.target(), signal: this.lifetime.signal,
      getToken: () => {
        if (!this.authorization || this.authorization.expiresAt <= Date.now() + 5000) {
          throw new Error('Доступ Google истёк. Повторно войдите и проверьте восстановление.');
        }
        return this.authorization.token;
      },
    });
  }

  private clearPlan(): void {
    this.authorization = undefined;
    this.plan.set(null);
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Операция с резервной копией завершилась ошибкой.');
    } finally {
      this.busy.set(false);
    }
  }
}
