import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ComputerDocument, InventoryReport } from '../core/contracts/inventory-types';
import { InventoryData, editorEntry, effective, isStale, messageFor, optionalFields, optionalKeys,
  type Entry, type OptionalField } from '../core/inventory-data';
import { RecordEditor } from '../core/record-editor';
import { entryRows, RecordDetails } from '../core/record-details';
import { dateText, missing } from '../registry/registry-state';

const labels = { PENDING: 'Ожидает проверки', ACCEPTED: 'Принят', REJECTED: 'Отклонён' } as const;

@Component({ imports: [FormsModule, RouterLink, RecordEditor, RecordDetails], templateUrl: './reports.html' })
export class Reports {
  readonly data = inject(InventoryData);
  readonly text = signal('');
  readonly tab = signal<'pending' | 'processed'>('pending');
  readonly selectedId = signal('');
  readonly report = computed(() => this.data.reports().find(report => report.reportId === this.selectedId()) ?? null);
  readonly card = signal<ComputerDocument | null>(null);
  readonly proposed = computed(() => this.report() ? effective(this.report()!) : null);
  readonly draft = signal<Entry | null>(null);
  readonly loadingCard = signal(false);
  readonly cardError = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly rejectConfirmation = signal(false);
  readonly confirmedLocation = signal(false);
  readonly confirmedHost = signal(false);
  readonly choices = signal<ReadonlySet<OptionalField>>(new Set());
  readonly dateText = dateText;
  readonly missing = missing;
  readonly labels = labels;
  readonly effective = effective;
  readonly reports = computed(() => {
    const query = this.text().trim().toLowerCase();
    return this.data.reports().filter(report => (report.status === 'PENDING') === (this.tab() === 'pending')
      && (!query || [effective(report).hardware.hostname, report.hardware.hostname, report.deviceId,
        effective(report).assignment.building, effective(report).assignment.room].some(value => value.toLowerCase().includes(query))));
  });
  readonly stale = computed(() => this.report() ? isStale(this.report()!, this.card()) : false);
  readonly moved = computed(() => {
    const old = this.card();
    const proposed = this.proposed()?.assignment;
    return !!old && !!proposed && ['building', 'floor', 'room'].some(key => old[key as 'building' | 'floor' | 'room'] !== proposed[key as 'building' | 'floor' | 'room']);
  });
  readonly renamed = computed(() => !!this.card() && this.card()!.hostname !== this.proposed()?.hardware.hostname);
  readonly comparison = computed(() => {
    const previous = this.card() ? new Map(entryRows(editorEntry(this.card()!)).map(row => [row.label, row.value])) : null;
    const next = this.proposed();
    return next ? entryRows(next).map(row => {
      const old = previous?.get(row.label) ?? missing;
      return { ...row, old, changed: row.value !== old };
    }) : [];
  });
  readonly suggestedOptions = computed(() => {
    const current = this.card();
    const assignment = this.proposed()?.assignment;
    return optionalKeys.flatMap(key => assignment?.[key] && current?.[key] !== assignment[key]
      ? [{ key, label: optionalFields[key], value: assignment[key] }] : []);
  });

  constructor() {
    if (!this.data.reportsLoading()) void this.data.refreshReports();
  }

  selectTab(tab: 'pending' | 'processed'): void {
    this.tab.set(tab);
    this.selectedId.set('');
    this.notice.set('');
    this.clearReview();
  }

  async select(report: InventoryReport): Promise<void> {
    this.selectedId.set(report.reportId);
    this.notice.set('');
    this.clearReview();
    await this.loadComparison(report);
  }

  async reload(): Promise<void> {
    this.clearReview();
    await this.data.refreshReports();
    const report = this.report();
    if (report) await this.loadComparison(report);
  }

  private clearReview(): void {
    this.card.set(null);
    this.draft.set(null);
    this.error.set('');
    this.cardError.set('');
    this.rejectConfirmation.set(false);
    this.confirmedLocation.set(false);
    this.confirmedHost.set(false);
    this.choices.set(new Set());
  }

  private async loadComparison(report: InventoryReport): Promise<void> {
    const request = ++this.comparisonRequest;
    this.loadingCard.set(true);
    try {
      const card = await this.data.loadCard(report.deviceId);
      if (request === this.comparisonRequest && this.selectedId() === report.reportId) this.card.set(card);
    } catch (error) {
      if (request === this.comparisonRequest && this.selectedId() === report.reportId) this.cardError.set(messageFor(error));
    } finally {
      if (request === this.comparisonRequest) this.loadingCard.set(false);
    }
  }

  private comparisonRequest = 0;

  toggle(key: OptionalField, checked: boolean): void {
    const choices = new Set(this.choices());
    if (checked) choices.add(key);
    else choices.delete(key);
    this.choices.set(choices);
  }

  async save(report: InventoryReport, entry: Entry): Promise<void> {
    await this.perform(async () => {
      await this.data.saveCorrection(report, entry);
      this.draft.set(null);
      this.confirmedLocation.set(false);
      this.confirmedHost.set(false);
      this.choices.set(new Set());
      this.notice.set('Исправления сохранены. Проверьте отчёт перед принятием.');
    });
  }

  async review(report: InventoryReport, outcome: 'ACCEPTED' | 'REJECTED'): Promise<void> {
    if (outcome === 'ACCEPTED' && (this.loadingCard() || this.cardError() || this.stale()
      || this.moved() && !this.confirmedLocation() || this.renamed() && !this.confirmedHost())) return;
    await this.perform(async () => {
      await this.data.review(report, this.card(), this.choices(), outcome);
      if (outcome === 'ACCEPTED') await this.loadComparison(report);
      this.tab.set('processed');
      this.rejectConfirmation.set(false);
      this.notice.set(outcome === 'ACCEPTED' ? 'Отчёт принят. Карточка обновлена.' : 'Отчёт отклонён.');
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
