import { Injectable, computed, inject, signal } from '@angular/core';
import { InventoryData } from '../core/inventory-data';
import type { ComputerDocument, ContractTimestamp, Disk, Hardware, WarningCode } from '../core/contracts/inventory-types';

export const missing = '—';
export const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
export const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
export const stateLabels = { ACTIVE: 'Активен', RETIRED: 'В архиве' } as const;
export const diskLabels = { SSD: 'SSD', HDD: 'HDD', UNKNOWN: 'Тип неизвестен' } as const;
export const warningLabels: Record<WarningCode, string> = {
  CPU_ATTRIBUTES_UNAVAILABLE: 'Часть сведений о процессоре недоступна.',
  SYSTEM_ATTRIBUTES_UNAVAILABLE: 'Часть сведений о компьютере или материнской плате недоступна.',
  OS_ATTRIBUTES_UNAVAILABLE: 'Часть сведений об операционной системе недоступна.',
  GPU_ATTRIBUTES_UNAVAILABLE: 'Часть сведений о видеокартах недоступна.',
  RAM_MODULES_UNAVAILABLE: 'Модули ОЗУ не определены.',
  RAM_CAPACITY_OS_VISIBLE: 'Показан объём ОЗУ, видимый операционной системе.',
  RAM_SLOT_TOPOLOGY_PARTIAL: 'Расположение или состояние части слотов ОЗУ неизвестно.',
  RAM_SOURCE_CONFLICT: 'Источники расходятся по объёму или слотам ОЗУ.',
  RAM_SPEED_UNAVAILABLE: 'Скорость одного или нескольких модулей ОЗУ неизвестна.',
  DISK_ATTRIBUTES_UNAVAILABLE: 'Часть сведений о накопителях недоступна.',
  DISK_TYPES_UNAVAILABLE: 'Тип одного или нескольких накопителей неизвестен.',
  NETWORK_MODE_UNAVAILABLE: 'Режим IPv4 неизвестен.',
  NETWORK_ADAPTER_UNCLASSIFIED: 'Тип одного из активных адаптеров неизвестен.',
  STATIC_IPV4_UNAVAILABLE: 'Статический IPv4 одного из адаптеров недоступен.',
  IDENTITY_PROFILE_FALLBACK: 'Используется идентификатор профиля Windows.',
};

export function dateText(value: ContractTimestamp | null | undefined): string {
  if (!value) return missing;
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    .format(new Date(value.seconds * 1000 + value.nanoseconds / 1e6));
}

export function diskText(disk: Disk): string {
  const size = disk.capacityBytes;
  return diskLabels[disk.type] + (size === null ? '' : ' '
    + numberFormat.format(size >= 1e12 ? size / 1e12 : size / 1e9) + (size >= 1e12 ? ' TB' : ' GB'));
}

export function ramText(hardware: Hardware): string {
  if (hardware.ramTotalGiB === null) return missing;
  return numberFormat.format(hardware.ramTotalGiB) + ' GiB' + (hardware.ramType === 'UNKNOWN' ? '' : ' ' + hardware.ramType);
}

type Cell = string | number | null;
type Column = { key: string; title: string; value: (card: ComputerDocument) => Cell; sort?: (card: ComputerDocument) => Cell };
export const columns: readonly Column[] = [
  { key: 'host', title: 'Имя ПК', value: card => card.hostname },
  { key: 'cpu', title: 'Процессор', value: card => card.cpuModel },
  { key: 'ram', title: 'ОЗУ', value: ramText, sort: card => card.ramTotalGiB },
  { key: 'slots', title: 'Слоты', value: card => card.ramSlotsUsed === null ? null : card.ramSlotsUsed + ' / ' + (card.ramSlotsTotal ?? '?'), sort: card => card.ramSlotsUsed },
  { key: 'storage', title: 'Накопители', value: card => card.disks.map(diskText).join(' + ') || null, sort: card => card.storageTotalBytes },
  { key: 'employee', title: 'ФИО', value: card => card.employeeName || null },
  { key: 'room', title: 'Кабинет', value: card => card.room },
  { key: 'inventory', title: 'Инв. №', value: card => card.inventoryNumber || null },
  { key: 'status', title: 'Статус', value: card => stateLabels[card.status ?? 'ACTIVE'] },
  { key: 'building', title: 'Здание', value: card => card.building },
  { key: 'floor', title: 'Этаж', value: card => card.floor },
  { key: 'department', title: 'Подразделение', value: card => card.department || null },
  { key: 'gpu', title: 'Видеокарты', value: card => card.gpuModels.join(', ') || null },
  { key: 'board', title: 'Материнская плата', value: card => card.motherboardModel },
  { key: 'os', title: 'ОС', value: card => card.osName },
  { key: 'network', title: 'Сеть / IP', value: card => [card.networkMode, ...card.staticIpv4].join(' · ') },
  { key: 'last', title: 'Инвентаризация', value: card => dateText(card.lastInventoryAt), sort: card => card.lastInventoryAt?.seconds ?? null },
];

type Filter = { key: string; label: string; values: (card: ComputerDocument) => string[] };
function textValues(value: string | null): string[] { return [value || 'Неизвестно']; }
export const filters: readonly Filter[] = [
  { key: 'vendor', label: 'Производитель CPU', values: c => textValues(c.cpuManufacturer) },
  { key: 'cpu', label: 'Модель CPU', values: c => textValues(c.cpuModel) },
  { key: 'gpu', label: 'Видеокарта', values: c => c.gpuModels.length ? c.gpuModels : ['Неизвестно'] },
  { key: 'ram', label: 'Тип ОЗУ', values: c => textValues(c.ramType === 'UNKNOWN' ? null : c.ramType) },
  { key: 'free', label: 'Свободные слоты', values: c => [freeSlotLabel(c.ramSlotsFree)] },
  { key: 'freeCount', label: 'Число свободных слотов', values: c => textValues(c.ramSlotsFree?.toString() ?? null) },
  { key: 'ssd', label: 'Наличие SSD', values: c => [ssdLabel(c.hasSsd)] },
  { key: 'os', label: 'ОС', values: c => textValues(c.osName) },
  { key: 'network', label: 'Режим сети', values: c => textValues(c.networkMode === 'UNKNOWN' ? null : c.networkMode) },
];
export function freeSlotLabel(count: number | null): string {
  return count === null ? 'Неизвестно' : count > 0 ? 'Есть свободные' : 'Нет свободных';
}
export function ssdLabel(state: boolean | null): string {
  return state === null ? 'Неизвестно' : state ? 'Есть SSD' : 'Только HDD';
}

export type Place = { building: string; floor?: string; room?: string };
function placeMatches(card: ComputerDocument, place: Place): boolean {
  return card.building === place.building && (!place.floor || card.floor === place.floor)
    && (!place.room || card.room === place.room);
}

function locationTree(cards: readonly ComputerDocument[]) {
  const buildings = new Map<string, Map<string, Map<string, number>>>();
  for (const { building, floor, room } of cards) {
    if (!buildings.has(building)) buildings.set(building, new Map());
    const floors = buildings.get(building)!;
    if (!floors.has(floor)) floors.set(floor, new Map());
    const rooms = floors.get(floor)!;
    rooms.set(room, (rooms.get(room) ?? 0) + 1);
  }
  const sorted = <T>(values: Map<string, T>) => [...values].sort(([a], [b]) => collator.compare(a, b));
  return sorted(buildings).map(([name, floors]) => ({
    name,
    count: cards.filter(card => card.building === name).length,
    floors: sorted(floors).map(([floor, rooms]) => ({
      name: floor, count: [...rooms.values()].reduce((a, b) => a + b, 0),
      rooms: sorted(rooms).map(([name, count]) => ({ name, count })),
    })),
  }));
}

@Injectable({ providedIn: 'root' })
export class RegistryState {
  private readonly data = inject(InventoryData);
  readonly text = signal('');
  readonly status = signal<'ACTIVE' | 'RETIRED' | 'ALL'>('ACTIVE');
  readonly place = signal<Place | null>(null);
  readonly choices = signal<Record<string, string[]>>({});
  readonly minRam = signal<number | null>(null);
  readonly maxRam = signal<number | null>(null);
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly sort = signal({ column: 'host', ascending: true });
  readonly size = signal(25);
  readonly page = signal(1);
  readonly visibleColumns = signal<string[]>(columns.slice(0, 9).map(column => column.key));

  readonly filteredWithoutPlace = computed(() => {
    const text = this.text().trim().toLowerCase();
    const status = this.status();
    const choices = this.choices();
    const min = this.minRam();
    const max = this.maxRam();
    const from = this.fromDate() ? Date.parse(this.fromDate() + 'T00:00:00') : null;
    const to = this.toDate() ? Date.parse(this.toDate() + 'T00:00:00') : null;
    const end = to === null ? null : new Date(to).setDate(new Date(to).getDate() + 1);
    return this.data.cards().filter(card => {
      const scanned = card.lastInventoryAt ? card.lastInventoryAt.seconds * 1000 : null;
      return (status === 'ALL' || status === (card.status ?? 'ACTIVE'))
        && (!text || [card.hostname, card.cpuModel, ...card.gpuModels, card.employeeName, card.department,
          ...card.staticIpv4, card.room, card.inventoryNumber, card.building, card.floor]
          .some(value => value?.toLowerCase().includes(text)))
        && filters.every(filter => !choices[filter.key]?.length
          || filter.values(card).some(value => choices[filter.key].includes(value)))
        && (min === null || (card.ramTotalGiB !== null && card.ramTotalGiB >= min))
        && (max === null || (card.ramTotalGiB !== null && card.ramTotalGiB <= max))
        && (from === null || (scanned !== null && scanned >= from))
        && (end === null || (scanned !== null && scanned < end));
    });
  });
  readonly tree = computed(() => locationTree(this.filteredWithoutPlace()));
  readonly filtered = computed(() => {
    const place = this.place();
    const { column, ascending } = this.sort();
    const definition = columns.find(item => item.key === column) ?? columns[0];
    const value = definition.sort ?? definition.value;
    return this.filteredWithoutPlace().filter(card => !place || placeMatches(card, place)).sort((a, b) => {
      const first = value(a);
      const second = value(b);
      if (first === null || second === null) return first === second ? collator.compare(a.hostname, b.hostname) : first === null ? 1 : -1;
      const order = typeof first === 'number' && typeof second === 'number' ? first - second
        : collator.compare(String(first), String(second));
      return order ? order * (ascending ? 1 : -1) : collator.compare(a.hostname, b.hostname);
    });
  });
  readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.size())));
  readonly currentPage = computed(() => Math.min(this.page(), this.pages()));
  readonly rows = computed(() => this.filtered().slice((this.currentPage() - 1) * this.size(), this.currentPage() * this.size()));
  readonly filterCount = computed(() => Object.values(this.choices()).filter(value => value.length).length
    + (this.place() ? 1 : 0) + (this.status() === 'ACTIVE' ? 0 : 1)
    + (this.minRam() !== null || this.maxRam() !== null ? 1 : 0) + (this.fromDate() || this.toDate() ? 1 : 0));
  readonly location = computed(() => {
    const place = this.place();
    return place ? [place.building, place.floor, place.room].filter(Boolean).join(' / ') : '';
  });

  setPlace(place: Place | null): void { this.place.set(place); this.page.set(1); }

  setChoices(key: string, values: string[]): void {
    this.choices.update(previous => ({ ...previous, [key]: values }));
    this.page.set(1);
  }

  reset(): void {
    this.text.set('');
    this.status.set('ACTIVE');
    this.place.set(null);
    this.choices.set({});
    this.minRam.set(null);
    this.maxRam.set(null);
    this.fromDate.set('');
    this.toDate.set('');
    this.page.set(1);
    this.sort.set({ column: 'host', ascending: true });
  }
}
