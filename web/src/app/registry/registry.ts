import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventoryData } from '../core/inventory-data';
import { RegistryState, collator, columns, computerModelText, deviceTypeText, filters, missing, setLocationTreeOpen,
  type Place } from './registry-state';
import { Card } from './card';
import { exportCards } from './xlsx-export';

@Component({ selector: 'app-registry', imports: [FormsModule, NgTemplateOutlet, RouterLink, Card], templateUrl: './registry.html' })
export class Registry {
  readonly data = inject(InventoryData);
  readonly state = inject(RegistryState);
  readonly setTreeOpen = setLocationTreeOpen;
  private readonly treeNodes = viewChild<ElementRef<HTMLElement>>('treeNodes');
  private readonly desktopViewport = matchMedia('(min-width: 801px)');
  readonly desktop = signal(this.desktopViewport.matches);
  readonly selectedId = signal<string | null>(null);
  readonly embeddedCard = viewChild(Card);
  readonly embeddedCardIds = computed(() => {
    const id = this.selectedId();
    return this.desktop() && id ? [id] : [];
  });
  readonly computerModelText = computerModelText;
  readonly deviceTypeText = deviceTypeText;
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
    const resize = (event: MediaQueryListEvent) => {
      this.desktop.set(event.matches);
      if (!event.matches) this.selectedId.set(null);
    };
    this.desktopViewport.addEventListener('change', resize);
    inject(DestroyRef).onDestroy(() => this.desktopViewport.removeEventListener('change', resize));
    if (!this.data.cardsLoaded()) void this.data.refreshCards();
    afterRenderEffect({
      earlyRead: () => {
        const branches = new Set<HTMLDetailsElement>();
        const tree = this.treeNodes()?.nativeElement;
        if (!tree || !this.state.locationSearch().trim() || !this.state.tree().length) return branches;

        for (const mark of tree.querySelectorAll('mark')) {
          const node = mark.closest('summary')?.parentElement ?? mark;
          for (let branch = node.parentElement?.closest('details'); branch; branch = branch.parentElement?.closest('details')) {
            branches.add(branch);
          }
        }
        return branches;
      },
      write: branches => {
        for (const branch of branches()) branch.open = true;
      },
    });
  }

  selectPlace(place: Place | null): void {
    this.selectedId.set(null);
    this.state.setPlace(place);
  }

  openCard(id: string, place: Place): void {
    if (this.selectedId() === id) this.selectedId.set(null);
    else {
      this.state.setPlace(place);
      this.selectedId.set(id);
    }
  }

  refresh(): void {
    const card = this.embeddedCard();
    void this.data.refreshCards();
    if (card && !card.draft() && !card.busy()) void card.load();
  }

  toggleColumn(key: string): void {
    this.state.visibleColumns.update(list => list.includes(key) ? list.filter(item => item !== key) : [...list, key]);
  }

  toggleFilter(key: string, value: string, checked: boolean): void {
    this.selectedId.set(null);
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
