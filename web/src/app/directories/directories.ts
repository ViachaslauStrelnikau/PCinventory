import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { type InventoryLocation } from '../../../../shared/location-directory.mjs';
import { InventoryData } from '../core/inventory-data';
import type { DirectoryCommand } from '../core/directory-store';
import { RegistryState, locationTree } from '../registry/registry-state';

const empty: InventoryLocation = { building: '', floor: '', room: '' };
const labels = { building: 'Здание', floor: 'Этаж', room: 'Кабинет' } as const;
type Level = keyof typeof labels;
type Editor = { action: 'create' | 'rename'; level: Level; path: InventoryLocation };

const errors: Record<string, string> = {
  'invalid-location': 'Проверьте название или номер.',
  'location-exists': 'В этой ветке уже есть запись с таким названием или номером.',
  'location-missing': 'Эта запись изменилась. Обновите справочник.',
  'location-in-use': 'Расположение используется в карточках ПК, включая архив.',
  'location-has-children': 'Сначала удалите вложенные записи этого расположения.',
  'parent-location-missing': 'Родительская запись изменилась. Обновите справочник.',
  'concurrent-update': 'Справочник изменился в другой вкладке. Обновите его и повторите действие.',
  'historical-location': 'Это прежнее название другого расположения. Выберите другое имя.',
  'rename-limit': 'Не удалось обновить всю ветку в одной транзакции.',
  'admin-required': 'Для редактирования справочника нужны права администратора.',
};

@Component({ imports: [FormsModule, RouterLink], templateUrl: './directories.html' })
export class Directories {
  readonly data = inject(InventoryData);
  private readonly registry = inject(RegistryState);
  readonly tree = computed(() => locationTree(this.data.cards(), this.data.locations()));
  readonly selected = signal<InventoryLocation | null>(null);
  readonly editor = signal<Editor | null>(null);
  readonly confirmingDelete = signal(false);
  readonly busy = signal(false);
  readonly notice = signal('');
  readonly error = signal('');
  readonly labels = labels;
  readonly deleteBlock = computed(() => {
    const selected = this.selected();
    if (!selected) return '';
    if (this.data.locationsError() || this.data.cardsError()) return 'Обновите справочник перед удалением.';
    const building = this.tree().find(node => node.name === selected.building);
    const floor = building?.floors.find(node => node.name === selected.floor);
    const room = floor?.rooms.find(node => node.name === selected.room);
    const node = selected.room ? room : selected.floor ? floor : building;
    if (!node) return errors['location-missing'];
    if (node.count) return errors['location-in-use'];
    if (!selected.floor && building?.floors.length || !selected.room && floor?.rooms.length) {
      return errors['location-has-children'];
    }
    return '';
  });
  draft = '';

  constructor() { void this.data.refreshCards(); }

  setTreeOpen(tree: HTMLElement, open: boolean): void {
    for (const branch of tree.querySelectorAll<HTMLDetailsElement>('details')) branch.open = open;
  }

  matches(building: string, floor = '', room = ''): boolean {
    const selected = this.selected();
    return !!selected && selected.building === building && selected.floor === floor && selected.room === room;
  }

  select(building: string, floor = '', room = ''): void {
    this.selected.set({ building, floor, room });
    this.editor.set(null);
    this.confirmingDelete.set(false);
    this.error.set('');
  }

  openCreate(level: Level, path: InventoryLocation = empty): void {
    this.open({ action: 'create', level, path }, '');
  }

  openRename(path: InventoryLocation): void {
    const level = path.room ? 'room' : path.floor ? 'floor' : 'building';
    this.open({ action: 'rename', level, path }, path[level]);
  }

  private open(editor: Editor, draft: string): void {
    this.notice.set('');
    this.error.set('');
    this.confirmingDelete.set(false);
    this.draft = draft;
    this.editor.set(editor);
  }

  async save(): Promise<void> {
    const editor = this.editor();
    const name = this.draft.trim();
    if (!editor || this.busy() || !name) return;
    const { action, level, path } = editor;
    const resultPath = { ...path, [level]: name };
    const command: DirectoryCommand = action === 'rename' ? { action, path, name } : { action, path: resultPath };
    await this.perform(command, () => {
      if (action === 'rename') {
        const selection = this.registry.place();
        if (selection?.building === path.building && (!path.floor || selection.floor === path.floor)
            && (!path.room || selection.room === path.room)) {
          this.registry.setPlace({ ...selection, [level]: name });
        }
      }
      this.select(resultPath.building, resultPath.floor, resultPath.room);
      this.notice.set(action === 'create' ? 'Запись добавлена.' : 'Название обновлено.');
    });
  }

  openDelete(): void {
    this.notice.set('');
    this.error.set('');
    this.confirmingDelete.set(true);
  }

  async remove(path: InventoryLocation): Promise<void> {
    if (!this.confirmingDelete() || this.deleteBlock() || this.data.cardsLoading()) return;
    await this.perform({ action: 'delete', path }, () => {
      const place = this.registry.place();
      if (place?.building === path.building && (!path.floor || place.floor === path.floor)
          && (!path.room || place.room === path.room)) {
        this.registry.setPlace(path.room ? { building: path.building, floor: path.floor }
          : path.floor ? { building: path.building } : null);
      }
      if (path.room) this.select(path.building, path.floor);
      else if (path.floor) this.select(path.building);
      else {
        this.selected.set(null);
        this.confirmingDelete.set(false);
      }
      this.notice.set('Запись удалена.');
    });
  }

  private async perform(command: DirectoryCommand, complete: () => void): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.data.updateDirectory(command);
      complete();
    } catch (error) {
      const message = (error as { message?: string } | null)?.message;
      this.error.set(message && Object.hasOwn(errors, message) ? errors[message] : 'Не удалось сохранить справочник. Попробуйте ещё раз.');
      if (message === 'location-in-use' || message === 'location-has-children' || message === 'location-missing') {
        await this.data.refreshCards();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
