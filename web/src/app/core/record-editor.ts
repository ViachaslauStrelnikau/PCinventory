import { Component, input, output, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { optionalFields, optionalKeys, type Entry } from './inventory-data';
import type { Hardware } from './contracts/inventory-types';
import { deviceTypeLabels } from '../registry/registry-state';

type Value = string | number | boolean | null | string[];
type Field = { key: string; label: string; kind?: 'number' | 'addresses'; choices?: readonly Value[];
  choiceLabels?: Readonly<Record<string, string>> };
const numbers = (pairs: [string, string][]): Field[] => pairs.map(([key, label]) => ({ key, label, kind: 'number' }));
const texts = (pairs: [string, string][]): Field[] => pairs.map(([key, label]) => ({ key, label }));
const ramTypes = ['DDR', 'DDR2', 'DDR2 FB-DIMM', 'DDR3', 'DDR4', 'DDR5', 'LPDDR', 'LPDDR2', 'LPDDR3', 'LPDDR4', 'LPDDR5'];
const moduleFields = [
  ...numbers([['capacityBytes', 'Объём, байт'], ['speedMtps', 'Скорость, MT/s'], ['configuredSpeedMtps', 'Настроенная скорость, MT/s']]),
  { key: 'memoryType', label: 'Тип памяти', choices: [null, ...ramTypes] },
  ...texts([['manufacturer', 'Производитель'], ['partNumber', 'Номер детали'], ['formFactor', 'Форм-фактор']]),
];
type Section = { key: 'gpus' | 'ramSlots' | 'disks' | 'networks'; label: string; fields: Field[]; defaults?: Record<string, Value> };
const defaults = (fields: Field[]): Record<string, Value> => Object.fromEntries(fields.map(field => [field.key, null]));
const groups: Section[] = [
  { key: 'gpus', label: 'Видеокарты', fields: [...texts([['model', 'Модель'], ['manufacturer', 'Производитель']]), ...numbers([['vramBytes', 'Видеопамять, байт']])] },
  { key: 'ramSlots', label: 'Слоты ОЗУ', fields: [
    ...texts([['slotId', 'Обозначение слота'], ['bankLabel', 'Банк памяти']]),
    { key: 'occupied', label: 'Состояние слота', choices: [null, true, false] }, ...moduleFields,
  ], defaults: { occupied: true } },
  { key: 'disks', label: 'Накопители', fields: [
    ...texts([['model', 'Модель'], ['interface', 'Интерфейс']]),
    { key: 'type', label: 'Тип', choices: ['UNKNOWN', 'SSD', 'HDD'] }, ...numbers([['capacityBytes', 'Объём, байт']]),
  ], defaults: { type: 'UNKNOWN' } },
  { key: 'networks', label: 'Сетевые адаптеры', fields: [
    ...texts([['name', 'Имя']]), { key: 'mode', label: 'Режим', choices: ['UNKNOWN', 'DHCP', 'STATIC'] },
    { key: 'staticIpv4', label: 'Статические IPv4 через запятую', kind: 'addresses' },
  ], defaults: { mode: 'UNKNOWN', staticIpv4: [] } },
];

export function manualEntry(): Entry {
  return {
    assignment: { building: '', floor: '', room: '' },
    hardware: {
      schemaVersion: 1, agentVersion: 'manual', identitySource: 'MANUAL', hostname: '',
      cpuManufacturer: null, cpuModel: null, cpuModelRaw: null, cpuCores: null, cpuThreads: null,
      motherboardManufacturer: null, motherboardModel: null, motherboardSerial: null,
      computerManufacturer: null, computerModel: null, osName: null, osVersion: null, osBuild: null, osArchitecture: null,
      gpuModels: [], gpus: [], ramTotalBytes: null, ramTotalGiB: null, ramType: 'UNKNOWN',
      ramSlotsTotal: null, ramSlotsUsed: null, ramSlotsFree: null, ramSlotTopology: 'UNKNOWN', ramSlots: [],
      storageTotalBytes: null, hasSsd: null, disks: [], networkMode: 'UNKNOWN', staticIpv4: [], networks: [], warnings: [],
    },
  };
}

function normalize(h: Hardware, previous: Hardware): void {
  h.gpuModels = [...new Set(h.gpus.flatMap(gpu => gpu.model === null ? [] : [gpu.model]))];
  h.ramTotalGiB = h.ramTotalBytes === null ? null : h.ramTotalBytes / 1024 ** 3;
  if (h.ramSlotTopology !== previous.ramSlotTopology || h.ramSlotsTotal !== previous.ramSlotsTotal
    || JSON.stringify(h.ramSlots) !== JSON.stringify(previous.ramSlots)) {
    for (const slot of h.ramSlots) {
      if (slot.occupied !== true) Object.assign(slot, defaults(moduleFields));
    }
    const occupied = h.ramSlots.filter(slot => slot.occupied === true).length;
    if (h.ramSlotTopology === 'COMPLETE') h.ramSlotsTotal = h.ramSlots.length;
    h.ramSlotsUsed = h.ramSlots.length || h.ramSlotsUsed !== null || h.ramSlotTopology === 'COMPLETE' ? occupied : null;
    h.ramSlotsFree = (h.ramSlotTopology === 'COMPLETE' || h.ramSlotsFree !== null)
      && h.ramSlotsTotal !== null && h.ramSlotsUsed !== null ? h.ramSlotsTotal - h.ramSlotsUsed : null;
  }
  h.storageTotalBytes = h.disks.length && h.disks.every(disk => disk.capacityBytes !== null)
    ? h.disks.reduce((sum, disk) => sum + (disk.capacityBytes ?? 0), 0) : null;
  h.hasSsd = h.disks.some(disk => disk.type === 'SSD') ? true
    : h.disks.length && h.disks.every(disk => disk.type === 'HDD') ? false : null;
  for (const adapter of h.networks) {
    adapter.staticIpv4 = adapter.mode === 'STATIC' ? [...new Set(adapter.staticIpv4)] : [];
  }
  h.staticIpv4 = [...new Set(h.networks.flatMap(adapter => adapter.staticIpv4))];
  const dhcp = h.networks.some(adapter => adapter.mode === 'DHCP');
  const fixed = h.networks.some(adapter => adapter.mode === 'STATIC');
  const unknown = h.warnings.includes('NETWORK_ADAPTER_UNCLASSIFIED') || h.networks.some(adapter => adapter.mode === 'UNKNOWN');
  h.networkMode = dhcp && fixed ? 'MIXED' : unknown ? 'UNKNOWN' : dhcp ? 'DHCP' : fixed ? 'STATIC' : 'UNKNOWN';
}

@Component({ selector: 'app-record-editor', imports: [FormsModule], templateUrl: './record-editor.html' })
export class RecordEditor implements OnInit {
  readonly entry = input.required<Entry>();
  readonly busy = input(false);
  readonly report = input(false);
  readonly saveLabel = input('Сохранить');
  readonly save = output<Entry>();
  readonly cancel = output<void>();
  readonly assignmentFields = [
    { key: 'building', label: 'Здание', required: true, max: 256 }, { key: 'floor', label: 'Этаж', required: true, max: 64 },
    { key: 'room', label: 'Кабинет', required: true, max: 64 },
    ...optionalKeys.filter(key => key !== 'comment').map(key => ({ key, label: optionalFields[key], required: false, max: 256 })),
  ] as const;
  readonly fields: Field[] = [
    { key: 'deviceType', label: 'Тип устройства', choices: ['UNKNOWN', 'LAPTOP', 'DESKTOP'], choiceLabels: deviceTypeLabels },
    ...texts([['cpuModel', 'Модель процессора'], ['cpuManufacturer', 'Производитель CPU'], ['cpuModelRaw', 'Исходная строка CPU']]),
    ...numbers([['cpuCores', 'Ядра'], ['cpuThreads', 'Потоки']]),
    ...texts([['motherboardManufacturer', 'Производитель платы'], ['motherboardModel', 'Модель материнской платы'],
      ['motherboardSerial', 'Серийный номер платы'], ['computerManufacturer', 'Производитель компьютера'],
      ['computerModel', 'Модель компьютера'], ['osName', 'Операционная система'], ['osVersion', 'Версия ОС'], ['osBuild', 'Сборка ОС']]),
    { key: 'osArchitecture', label: 'Разрядность ОС', choices: [null, 'x86', 'x64'] },
    ...numbers([['ramTotalBytes', 'Общий объём ОЗУ, байт'], ['ramSlotsTotal', 'Всего слотов ОЗУ']]),
    { key: 'ramType', label: 'Тип ОЗУ', choices: ['UNKNOWN', 'MIXED', ...ramTypes] },
    { key: 'ramSlotTopology', label: 'Схема слотов', choices: ['UNKNOWN', 'PARTIAL', 'COMPLETE'] },
  ];
  readonly groups = groups;
  readonly standalone = { standalone: true };
  draft!: Entry;

  ngOnInit(): void {
    const { hardware, assignment } = this.entry();
    this.draft = structuredClone({ hardware, assignment });
  }

  hardware(): Record<string, Value> { return this.draft.hardware as unknown as Record<string, Value>; }
  items(group: Section): Record<string, Value>[] { return this.draft.hardware[group.key] as unknown as Record<string, Value>[]; }
  add(group: Section): void { this.items(group).push({ ...defaults(group.fields), ...group.defaults }); }
  update(item: Record<string, Value>, field: Field, value: Value): void {
    item[field.key] = field.kind === 'addresses' && typeof value === 'string'
      ? value.split(/[\s,;]+/).filter(Boolean) : typeof value === 'string' && !value.trim() ? null : value;
  }

  label(value: Value, field?: Field): string {
    if (typeof value === 'string' && field?.choiceLabels) return field.choiceLabels[value] ?? value;
    if (value === true) return 'Занят';
    if (value === false) return 'Свободен';
    return value === null || value === 'UNKNOWN' ? 'Неизвестно'
      : value === 'COMPLETE' ? 'Полная' : value === 'PARTIAL' ? 'Частичная'
      : value === 'MIXED' ? 'Смешанный' : String(value);
  }

  submit(): void {
    const entry = structuredClone(this.draft);
    entry.hardware.hostname = entry.hardware.hostname.trim();
    for (const key of ['building', 'floor', 'room'] as const) entry.assignment[key] = entry.assignment[key].trim();
    for (const key of optionalKeys) {
      const value = entry.assignment[key]?.trim();
      if (this.report() && !value) delete entry.assignment[key];
      else entry.assignment[key] = value ?? '';
    }
    normalize(entry.hardware, this.entry().hardware);
    this.save.emit(entry);
  }
}
