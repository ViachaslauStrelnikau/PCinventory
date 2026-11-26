import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventoryData } from '../core/inventory-data';
import { RegistryState, collator, columns, filters, missing, setLocationTreeOpen } from './registry-state';
import { exportCards } from './xlsx-export';

@Component({ selector: 'app-registry', imports: [FormsModule, RouterLink], templateUrl: './registry.html' })
export class Registry {
  readonly data = inject(InventoryData);
  readonly state = inject(RegistryState);
  readonly setTreeOpen = setLocationTreeOpen;
  readonly columns = columns;
  readonly filters = filters;
  readonly missing = missing;
  readonly visible = computed(() => columns.filter(column => this.state.visibleColumns().includes(column.key)));
  readonly options = computed(() => Object.fromEntries(filters.map(filter => {
    const values = this.data.cards().flatMap(filter.values);
    return [filter.key, [...new Set(values)].sort(collator.compare)];
  })));
  readonly exporting = signal(false);
  readonly exportError = signal('');

  constructor() {
    if (!this.data.cardsLoaded()) void this.data.refreshCards();
  }

  toggleColumn(key: string): void {
    this.state.visibleColumns.update(list => list.includes(key) ? list.filter(item => item !== key) : [...list, key]);
  }

  toggleFilter(key: string, value: string, checked: boolean): void {
    const values = this.state.choices()[key] ?? [];
    this.state.setChoices(key, checked ? [...values, value] : values.filter(item => item !== value));
  }

  sort(key: string): void {
    this.state.sort.update(previous => ({ column: key, ascending: previous.column !== key || !previous.ascending }));
    this.state.page.set(1);
  }

  async download(): Promise<void> {
    this.exporting.set(true);
    this.exportError.set('');
    try {
      await exportCards(this.state.filtered());
    } catch {
      this.exportError.set('Не удалось сформировать файл Excel.');
    } finally {
      this.exporting.set(false);
    }
  }
}
