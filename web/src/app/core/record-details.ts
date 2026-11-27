import { Component, computed, input } from '@angular/core';
import type { Entry } from './inventory-data';
import { deviceTypeText, diskText, missing, numberFormat, ramText, warningLabels } from '../registry/registry-state';

const values = (...items: (string | number | null | undefined)[]) => items.filter(item => item !== null && item !== undefined && item !== '').join(' · ') || missing;
const bytes = (value: number | null) => value === null ? null : numberFormat.format(value / 1024 ** 3) + ' GiB';
export function entryRows(entry: Entry): { label: string; value: string }[] {
  const { hardware: h, assignment: a } = entry;
  return [
    ['Имя ПК', h.hostname], ['Тип устройства', deviceTypeText(h)],
    ['Производитель', h.computerManufacturer], ['Модель', h.computerModel], ['Расположение', values(a.building, 'этаж ' + a.floor, 'каб. ' + a.room)],
    ['Инвентарный №', a.inventoryNumber], ['ФИО сотрудника', a.employeeName], ['Подразделение', a.department],
    ['Примечание', a.comment], ['Процессор', values(h.cpuModel, h.cpuManufacturer, h.cpuCores === null ? null : h.cpuCores + ' ядер',
      h.cpuThreads === null ? null : h.cpuThreads + ' потоков')],
    ['Исходная строка CPU', h.cpuModelRaw],
    ['Материнская плата', values(h.motherboardManufacturer, h.motherboardModel, h.motherboardSerial)],
    ['Операционная система', values(h.osName, h.osVersion, h.osBuild, h.osArchitecture)],
    ['Видеокарты', h.gpus.map(gpu => values(gpu.model, gpu.manufacturer, bytes(gpu.vramBytes))).join('\n')],
    ['ОЗУ', ramText(h)], ['Слоты ОЗУ', values(h.ramSlotTopology === 'COMPLETE' ? 'Полная схема'
      : h.ramSlotTopology === 'PARTIAL' ? 'Частичная схема' : 'Схема неизвестна',
      h.ramSlotsTotal === null ? null : 'Всего ' + h.ramSlotsTotal, h.ramSlotsUsed === null ? null : 'Занято ' + h.ramSlotsUsed,
      h.ramSlotsFree === null ? null : 'Свободно ' + h.ramSlotsFree)],
    ['Модули и слоты', h.ramSlots.map(slot => values(slot.slotId, slot.bankLabel,
      slot.occupied === null ? 'Состояние неизвестно' : slot.occupied ? 'Занят' : 'Свободен',
      bytes(slot.capacityBytes), slot.memoryType,
      (slot.configuredSpeedMtps ?? slot.speedMtps) === null ? null : (slot.configuredSpeedMtps ?? slot.speedMtps) + ' MT/s',
      slot.manufacturer, slot.partNumber, slot.formFactor)).join('\n')],
    ['Накопители', h.disks.map(disk => values(disk.model, diskText(disk), disk.interface)).join('\n')],
    ['Сеть', values(h.networkMode === 'UNKNOWN' ? 'Неизвестно' : h.networkMode, h.staticIpv4.join(', '))],
    ['Адаптеры', h.networks.map(adapter => values(adapter.name, adapter.mode, adapter.staticIpv4.join(', '))).join('\n')],
    ['Предупреждения', h.warnings.map(warning => warningLabels[warning]).join('\n')],
  ].map(([label, value]) => ({ label: label!, value: value || missing }));
}

@Component({
  selector: 'app-record-details',
  template: `
    <dl class="record-details">
      @for (row of rows(); track row.label) { <div><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div> }
    </dl>
  `,
})
export class RecordDetails {
  readonly entry = input.required<Entry>();
  readonly rows = computed(() => entryRows(this.entry()));
}
