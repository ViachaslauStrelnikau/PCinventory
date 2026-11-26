import type { BorderStyle } from 'exceljs';
import type { ComputerDocument } from '../core/contracts/inventory-types';
import { collator, diskLabels, numberFormat, stateLabels } from './registry-state';

const bytesPerGb = 1e9;

function cellBorder(style: BorderStyle) {
  const edge = { style };
  return { top: edge, right: edge, bottom: edge, left: edge };
}

export async function exportCards(cards: readonly ComputerDocument[]): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Компьютеры');
  const columns = [
    ['Здание', 15],
    ['Этаж', 5.85546875],
    ['Кабинет', 8.7109375],
    ['Инвентарный №', 17],
    ['Имя ПК', 15],
    ['ФИО', 15],
    ['Подразделение', 17],
    ['Процессор', 12.7109375],
    ['Ядра', 6.5703125],
    ['Потоки', 8.28515625],
    ['ОЗУ (GiB)', 9.85546875],
    ['Тип ОЗУ', 8.42578125],
    ['Всего слотов', 7.28515625],
    ['Занято слотов', 7.42578125],
    ['Свободно слотов', 11.140625],
    ['Материнская плата', 21],
    ['Видеокарты', 19.42578125],
    ['Накопители', 29.5703125],
    ['Объём дисков (GB)', 24, '#,##0.00'],
    ['ОС', 15],
    ['Сеть', 15],
    ['Статические IPv4', 16.42578125],
    ['Статус', 10.85546875],
    ['Инвентаризация', 16, 'dd.mm.yyyy'],
    ['Примечание', 25.7109375],
    ['Идентификатор', 25.28515625],
  ] as const;
  sheet.columns = columns.map(([header, width, numFmt]) => ({
    header, width, style: { alignment: { wrapText: true }, numFmt },
  }));
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
    const storageGb = card.storageTotalBytes === null ? null : card.storageTotalBytes / bytesPerGb;
    const inventoryDate = card.lastInventoryAt ? new Date(card.lastInventoryAt.seconds * 1000) : null;
    inventoryDate?.setUTCHours(0, 0, 0, 0);
    const row = sheet.addRow([
      card.building, card.floor, card.room, card.inventoryNumber, card.hostname, card.employeeName, card.department,
      card.cpuModel, card.cpuCores, card.cpuThreads, card.ramTotalGiB, card.ramType, card.ramSlotsTotal, card.ramSlotsUsed,
      card.ramSlotsFree, card.motherboardModel, card.gpuModels.join(', '),
      card.disks.map(disk => [diskLabels[disk.type], disk.model,
        disk.capacityBytes === null ? null : numberFormat.format(disk.capacityBytes / bytesPerGb) + ' GB']
        .filter(value => value !== null).join(' ')).join(' / '),
      storageGb, card.osName, card.networkMode, card.staticIpv4.join(', '), stateLabels[card.status ?? 'ACTIVE'],
      inventoryDate, card.comment, card.deviceId,
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
