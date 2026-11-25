import type { ComputerDocument } from '../core/contracts/inventory-types';
import { diskLabels, stateLabels } from './registry-state';

export async function exportCards(cards: readonly ComputerDocument[]): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Компьютеры');
  sheet.columns = [
    'Имя ПК', 'Идентификатор', 'Здание', 'Этаж', 'Кабинет', 'Инвентарный №', 'ФИО', 'Подразделение',
    'Процессор', 'Ядра', 'Потоки', 'ОЗУ (GiB)', 'Тип ОЗУ', 'Всего слотов', 'Занято слотов',
    'Свободно слотов', 'Материнская плата', 'Видеокарты', 'Накопители', 'Объём дисков (байты)',
    'ОС', 'Сеть', 'Статические IPv4', 'Статус', 'Инвентаризация', 'Примечание',
  ].map((header, i) => ({ header, width: i === 24 ? 22 : Math.max(15, header.length + 4) }));
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(25).numFmt = 'dd.mm.yyyy hh:mm';
  for (const card of cards) {
    sheet.addRow([
      card.hostname, card.deviceId, card.building, card.floor, card.room, card.inventoryNumber, card.employeeName, card.department,
      card.cpuModel, card.cpuCores, card.cpuThreads, card.ramTotalGiB, card.ramType, card.ramSlotsTotal, card.ramSlotsUsed,
      card.ramSlotsFree, card.motherboardModel, card.gpuModels.join(', '),
      card.disks.map(disk => [diskLabels[disk.type], disk.model, disk.capacityBytes === null ? null : disk.capacityBytes + ' B']
        .filter(value => value !== null).join(' ')).join(' / '),
      card.storageTotalBytes, card.osName, card.networkMode, card.staticIpv4.join(', '), stateLabels[card.status ?? 'ACTIVE'],
      card.lastInventoryAt ? new Date(card.lastInventoryAt.seconds * 1000) : null, card.comment,
    ]);
  }
  // ExcelJS represents plain string cells separately from formulas.
  const bytes = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pcinventory.xlsx';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
