import { Component, DestroyRef, computed, inject, input, output, signal, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ComputerDocument } from '../core/contracts/inventory-types';
import { InventoryData, editorEntry, messageFor, type Entry } from '../core/inventory-data';
import { RecordEditor, manualEntry } from '../core/record-editor';
import { RecordDetails } from '../core/record-details';
import { dateText, stateLabels } from './registry-state';

@Component({ selector: 'app-computer-card', imports: [RouterLink, RecordEditor, RecordDetails], templateUrl: './card.html' })
export class Card implements OnInit {
  readonly data = inject(InventoryData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private loadRequest = 0;
  readonly embeddedId = input<string>();
  readonly removed = output<void>();
  readonly card = signal<ComputerDocument | null>(null);
  readonly draft = signal<Entry | null>(null);
  readonly entry = computed(() => this.card() ? editorEntry(this.card()!) : null);
  readonly id = signal<string | null>(null);
  readonly title = computed(() => !this.id() ? 'Новая карточка ПК' : this.card()?.hostname || 'Карточка компьютера');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly confirming = signal(false);
  readonly dateText = dateText;
  readonly stateLabels = stateLabels;

  ngOnInit(): void {
    const embedded = this.embeddedId();
    if (embedded) this.open(embedded);
    else this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => this.open(params.get('id')));
  }

  private open(id: string | null): void {
    this.id.set(id);
    this.card.set(null);
    this.confirming.set(false);
    this.error.set('');
    this.notice.set('');
    this.draft.set(id ? null : manualEntry());
    if (id) void this.load();
    else this.loading.set(false);
  }

  async load(): Promise<void> {
    const id = this.id();
    if (!id) return;
    const request = ++this.loadRequest;
    this.error.set('');
    this.loading.set(true);
    try {
      const record = await this.data.loadCard(id);
      if (request === this.loadRequest && id === this.id()) this.card.set(record);
    } catch (error) {
      if (request === this.loadRequest && id === this.id()) this.error.set(messageFor(error));
    } finally {
      if (request === this.loadRequest && id === this.id()) this.loading.set(false);
    }
  }

  edit(): void {
    this.error.set('');
    this.notice.set('');
    this.draft.set(this.entry());
  }

  cancel(): void {
    this.error.set('');
    this.draft.set(null);
    if (!this.id()) void this.router.navigateByUrl('/computers');
  }

  async save(entry: Entry): Promise<void> {
    await this.perform(async () => {
      const card = this.card();
      if (card) {
        await this.data.editCard(card, entry);
        this.draft.set(null);
        await this.load();
        this.notice.set('Карточка сохранена.');
      } else {
        const id = await this.data.createCard(entry);
        await this.router.navigate(['/computers', id], { replaceUrl: true });
      }
    });
  }

  async changeStatus(card: ComputerDocument): Promise<void> {
    const archived = card.status === 'RETIRED';
    await this.perform(async () => {
      await this.data.archive(card, archived ? 'ACTIVE' : 'RETIRED');
      await this.load();
      this.notice.set(archived ? 'Карточка восстановлена.' : 'Карточка перемещена в архив.');
    });
  }

  async purge(card: ComputerDocument): Promise<void> {
    await this.perform(async () => {
      await this.data.purge(card);
      if (this.embeddedId()) this.removed.emit();
      else await this.router.navigateByUrl('/computers');
    });
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.error.set('');
    this.notice.set('');
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.error.set(messageFor(error));
    } finally {
      this.busy.set(false);
    }
  }
}
