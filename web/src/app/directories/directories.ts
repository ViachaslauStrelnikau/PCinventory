import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { type InventoryLocation } from '../../../../functions/location-directory.mjs';
import { InventoryData } from '../core/inventory-data';
import { LocalFunctions } from '../core/local-functions';
import { RegistryState, locationTree } from '../registry/registry-state';

const empty: InventoryLocation = { building: '', floor: '', room: '' };
const labels = { building: 'Здание', floor: 'Этаж', room: 'Кабинет' } as const;
type Level = keyof typeof labels;
type Editor = { action: 'create' | 'rename'; level: Level; path: InventoryLocation };
type Command = { action: 'create'; path: InventoryLocation } | { action: 'rename'; path: InventoryLocation; name: string };

const errors: Record<string, string> = {
  'invalid-location': 'Проверьте название или номер.',
  'location-exists': 'В этой ветке уже есть запись с таким названием или номером.',
  'location-missing': 'Эта запись изменилась. Обновите справочник.',
  'parent-location-missing': 'Родительская запись изменилась. Обновите справочник.',
  'concurrent-update': 'Справочник изменился в другой вкладке. Обновите его и повторите действие.',
  'rename-limit': 'Не удалось обновить всю ветку в одной транзакции.',
  'admin-required': 'Для редактирования справочника нужны права администратора.',
};

@Component({ imports: [FormsModule], templateUrl: './directories.html' })
export class Directories {
  readonly data = inject(InventoryData);
  private readonly functions = inject(LocalFunctions);
  private readonly registry = inject(RegistryState);
  readonly tree = computed(() => locationTree(this.data.cards(), this.data.locations()));
  readonly selected = signal<InventoryLocation | null>(null);
  readonly editor = signal<Editor | null>(null);
  readonly busy = signal(false);
  readonly notice = signal('');
  readonly error = signal('');
  readonly labels = labels;
  draft = '';

  constructor() { void this.data.refreshCards(); }

  matches(building: string, floor = '', room = ''): boolean {
    const selected = this.selected();
    return !!selected && selected.building === building && selected.floor === floor && selected.room === room;
  }

  select(building: string, floor = '', room = ''): void {
    this.selected.set({ building, floor, room });
    this.editor.set(null);
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
    this.draft = draft;
    this.editor.set(editor);
  }

  async save(): Promise<void> {
    const editor = this.editor();
    const name = this.draft.trim();
    if (!editor || this.busy() || !name) return;
    const { action, level, path } = editor;
    const resultPath = { ...path, [level]: name };
    const command: Command = action === 'rename' ? { action, path, name } : { action, path: resultPath };
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const result = await this.functions.invoke<Command, { updatedCards: number }>('manageLocations', command);
      if (action === 'rename') {
        const selection = this.registry.place();
        if (selection?.building === path.building && (!path.floor || selection.floor === path.floor)
            && (!path.room || selection.room === path.room)) {
          this.registry.setPlace({ ...selection, [level]: name });
        }
      }
      await this.data.refreshCards();
      this.select(resultPath.building, resultPath.floor, resultPath.room);
      this.notice.set(action === 'create' ? 'Запись добавлена.' : 'Название обновлено. Карточек обновлено: ' + result.updatedCards + '.');
    } catch (error) {
      const message = (error as { message?: string } | null)?.message;
      this.error.set(message && Object.hasOwn(errors, message) ? errors[message] : 'Не удалось сохранить справочник. Попробуйте ещё раз.');
    } finally {
      this.busy.set(false);
    }
  }
}
