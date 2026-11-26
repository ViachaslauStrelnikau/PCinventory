import type { BorderStyle } from 'exceljs';
import type { ComputerDocument } from '../core/contracts/inventory-types';
import { collator, diskLabels, stateLabels } from './registry-state';

function cellBorder(style: BorderStyle) {
  const edge = { style };
  return { top: edge, right: edge, bottom: edge, left: edge };
}

export async function exportCards(cards: readonly ComputerDocument[]): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Компьютеры');
  const dateHeader = 'Инвентаризация';
  const alignment = { wrapText: true };
  sheet.columns = [
    'Здание', 'Этаж', 'Кабинет', 'Инвентарный №', 'Имя ПК', 'ФИО', 'Подразделение',
    'Процессор', 'Ядра', 'Потоки', 'ОЗУ (GiB)', 'Тип ОЗУ', 'Всего слотов', 'Занято слотов',
    'Свободно слотов', 'Материнская плата', 'Видеокарты', 'Накопители', 'Объём дисков (байты)',
    'ОС', 'Сеть', 'Статические IPv4', 'Статус', dateHeader, 'Примечание', 'Идентификатор',
  ].map(header => header === dateHeader
    ? { header, width: 22, style: { alignment, numFmt: 'dd.mm.yyyy hh:mm' } }
    : { header, width: Math.max(15, header.length + 4), style: { alignment } });
  const header = sheet.getRow(1);
  header.font = { bold: true };
  const headerBorder = cellBorder('thick');
  header.eachCell(cell => { cell.border = headerBorder; });

  const sortedCards = [...cards].sort((a, b) => collator.compare(a.building, b.building)
    || collator.compare(a.floor, b.floor) || collator.compare(a.room, b.room)
    || Number(!a.inventoryNumber) - Number(!b.inventoryNumber)
    || collator.compare(a.inventoryNumber ?? '', b.inventoryNumber ?? ''));
  const bodyBorder = cellBorder('thin');
  for (const card of sortedCards) {
    const row = sheet.addRow([
      card.building, card.floor, card.room, card.inventoryNumber, card.hostname, card.employeeName, card.department,
      card.cpuModel, card.cpuCores, card.cpuThreads, card.ramTotalGiB, card.ramType, card.ramSlotsTotal, card.ramSlotsUsed,
      card.ramSlotsFree, card.motherboardModel, card.gpuModels.join(', '),
      card.disks.map(disk => [diskLabels[disk.type], disk.model, disk.capacityBytes === null ? null : disk.capacityBytes + ' B']
        .filter(value => value !== null).join(' ')).join(' / '),
      card.storageTotalBytes, card.osName, card.networkMode, card.staticIpv4.join(', '), stateLabels[card.status ?? 'ACTIVE'],
      card.lastInventoryAt ? new Date(card.lastInventoryAt.seconds * 1000) : null, card.comment, card.deviceId,
    ]);
    row.eachCell({ includeEmpty: true }, cell => { cell.border = bodyBorder; });
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
