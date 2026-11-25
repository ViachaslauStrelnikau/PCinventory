import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InventoryData } from './core/inventory-data';
import type { ComputerDocument } from './core/contracts/inventory-types';
import { RegistryState, collator, freeSlotLabel, numberFormat, ssdLabel } from './registry/registry-state';
import { exportCards } from './registry/xlsx-export';

type Group = { title: string; value: (card: ComputerDocument) => string | null; limit?: number };
const groups: Group[] = [
  { title: 'Производители CPU', value: card => card.cpuManufacturer },
  { title: 'Модели CPU', value: card => card.cpuModel, limit: 8 },
  { title: 'Объём ОЗУ', value: card => card.ramTotalGiB === null ? null : numberFormat.format(card.ramTotalGiB) + ' GiB' },
  { title: 'Тип ОЗУ', value: card => card.ramType === 'UNKNOWN' ? null : card.ramType === 'MIXED' ? 'Смешанный' : card.ramType },
  { title: 'Свободные слоты ОЗУ', value: card => freeSlotLabel(card.ramSlotsFree) },
  { title: 'Наличие SSD', value: card => ssdLabel(card.hasSsd) },
  { title: 'Операционные системы', value: card => card.osName, limit: 8 },
  { title: 'Конфигурация сети', value: card => card.networkMode === 'UNKNOWN' ? null : card.networkMode === 'MIXED' ? 'DHCP и статические' : card.networkMode },
];

function distribution(group: Group, cards: ComputerDocument[]) {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const card of cards) {
    const label = group.value(card);
    if (!label || label === 'Неизвестно') unknown++;
    else counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts].sort(([a, countA], [b, countB]) => countB - countA || collator.compare(a, b));
  const labels = sorted.slice(0, group.limit);
  const other = sorted.slice(labels.length).reduce((sum, [, count]) => sum + count, 0);
  return { title: group.title, rows: [
    ...labels.map(([label, count]) => ({ label, count, kind: 'known' })),
    ...(other ? [{ label: 'Другие', count: other, kind: 'other' }] : []),
    ...(unknown ? [{ label: 'Неизвестно', count: unknown, kind: 'unknown' }] : []),
  ].map(row => ({ ...row, percent: row.count * 100 / cards.length })) };
}

@Component({ imports: [RouterLink], templateUrl: './statistics.html' })
export class Statistics {
  readonly data = inject(InventoryData);
  readonly registry = inject(RegistryState);
  readonly useSelection = signal(false);
  readonly exporting = signal(false);
  readonly error = signal('');
  readonly cards = computed(() => this.useSelection() ? this.registry.filtered()
    : this.data.cards().filter(card => card.status !== 'RETIRED'));
  readonly charts = computed(() => groups.map(group => distribution(group, this.cards())));
  readonly totals = computed(() => {
    const cards = this.cards();
    return [
      { label: 'Компьютеры', count: cards.length },
      { label: 'Здания', count: new Set(cards.map(card => card.building)).size },
      { label: 'ПК с SSD', count: cards.filter(card => card.hasSsd === true).length },
      { label: 'ПК со свободными слотами ОЗУ', count: cards.filter(card => (card.ramSlotsFree ?? 0) > 0).length },
    ];
  });

  constructor() {
    if (!this.data.cardsLoaded()) void this.data.refreshCards();
  }

  async download(): Promise<void> {
    this.exporting.set(true);
    this.error.set('');
    try {
      await exportCards(this.cards());
    } catch {
      this.error.set('Не удалось сформировать файл Excel.');
    } finally {
      this.exporting.set(false);
    }
  }
}
