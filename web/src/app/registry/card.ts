import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ComputerDocument } from '../core/contracts/inventory-types';
import { InventoryData, editorEntry, messageFor, type Entry } from '../core/inventory-data';
import { RecordEditor, manualEntry } from '../core/record-editor';
import { RecordDetails } from '../core/record-details';
import { dateText, stateLabels } from './registry-state';

@Component({ imports: [RouterLink, RecordEditor, RecordDetails], templateUrl: './card.html' })
export class Card {
  readonly data = inject(InventoryData);
  private readonly router = inject(Router);
  readonly card = signal<ComputerDocument | null>(null);
  readonly draft = signal<Entry | null>(null);
  readonly entry = computed(() => this.card() ? editorEntry(this.card()!) : null);
  readonly id = signal<string | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly confirming = signal(false);
  readonly dateText = dateText;
  readonly stateLabels = stateLabels;

  constructor() {
    inject(ActivatedRoute).paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.id.set(params.get('id'));
      this.card.set(null);
      this.confirming.set(false);
      this.error.set('');
      this.notice.set('');
      this.draft.set(this.id() ? null : manualEntry());
      if (this.id()) void this.load();
    });
  }

  async load(): Promise<void> {
    const id = this.id();
    if (!id) return;
    this.error.set('');
    this.loading.set(true);
    try {
      const record = await this.data.loadCard(id);
      if (id === this.id()) this.card.set(record);
    } catch (error) {
      if (id === this.id()) this.error.set(messageFor(error));
    } finally {
      if (id === this.id()) this.loading.set(false);
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
      await this.router.navigateByUrl('/computers');
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
