import { Ajv2020 } from 'ajv/dist/2020.js';
import sharedSchema from '../../../../../contracts/shared.schema.json' with { type: 'json' };
import reportSchema from '../../../../../contracts/computer-report.schema.json' with { type: 'json' };
import computerSchema from '../../../../../contracts/computer-document.schema.json' with { type: 'json' };
import type { ComputerDocument, Hardware, InventoryReport, NetworkMode } from './inventory-types';

const validator = new Ajv2020({ ownProperties: true, strict: true });
validator.addSchema(sharedSchema);
const validateReport = validator.compile<InventoryReport>(reportSchema);
const validateComputer = validator.compile<ComputerDocument>(computerSchema);

const MAX_REPORT_BYTES = 64 * 1024;
const BYTES_PER_GIB = 1024 ** 3;

export function readReport(value: unknown): InventoryReport {
  requireValid(validateReport(value), 'JSON Schema');
  requireValid(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_REPORT_BYTES, 'report exceeds 64 KiB');
  checkHardware(value.deviceId, value.hardware);
  if (value.status !== 'PENDING') {
    const reviewed = value.reviewedAt;
    const submitted = value.submittedAt;
    requireValid(reviewed.seconds > submitted.seconds
      || (reviewed.seconds === submitted.seconds && reviewed.nanoseconds >= submitted.nanoseconds), 'reviewedAt');
  }
  return value;
}

export function readComputer(value: unknown): ComputerDocument {
  requireValid(validateComputer(value), 'JSON Schema');
  checkHardware(value.deviceId, value);
  return value;
}

function checkHardware(deviceId: string, hardware: Hardware): void {
  requireValid(deviceId.startsWith(hardware.identitySource.toLowerCase() + '-'), 'identitySource');
  requireValid(hardware.cpuCores === null || hardware.cpuThreads === null
    || hardware.cpuCores <= hardware.cpuThreads, 'CPU counts');
  const models = [...new Set(hardware.gpus.flatMap(gpu => gpu.model === null ? [] : [gpu.model]))];
  requireValid(models.length === hardware.gpuModels.length
    && models.every((model, index) => model === hardware.gpuModels[index]), 'gpuModels');
  checkMemory(hardware);
  checkStorage(hardware);
  checkNetwork(hardware);
}

function checkMemory(hardware: Hardware): void {
  const gib = hardware.ramTotalBytes === null ? null : hardware.ramTotalBytes / BYTES_PER_GIB;
  requireValid(hardware.ramTotalGiB === gib, 'ramTotalGiB');

  const { ramSlots: slots, ramSlotsTotal: total, ramSlotsUsed: used, ramSlotsFree: free } = hardware;
  const occupied = slots.filter(slot => slot.occupied === true).length;
  const empty = slots.filter(slot => slot.occupied === false).length;
  requireValid((total === null || slots.length <= total)
    && (used === null || used === occupied)
    && (free === null || (total !== null && used !== null && free === total - used && free >= empty)), 'RAM slot counts');

  if (hardware.ramSlotTopology === 'COMPLETE') {
    const labels = new Set(slots.map(slot => JSON.stringify(
      [slot.slotId?.toLowerCase() ?? null, slot.bankLabel?.toLowerCase() ?? null],
    )));
    requireValid(total !== null && used !== null && free !== null && total === slots.length
      && labels.size === total && slots.every(slot => slot.slotId !== null && slot.occupied !== null),
    'complete RAM topology');
  }
}

function checkStorage(hardware: Hardware): void {
  const anySsd = hardware.disks.some(disk => disk.type === 'SSD');
  const allHdd = hardware.disks.length > 0 && hardware.disks.every(disk => disk.type === 'HDD');
  requireValid(hardware.hasSsd === (anySsd ? true : allHdd ? false : null), 'hasSsd');

  const total = hardware.disks.length > 0 && hardware.disks.every(disk => disk.capacityBytes !== null)
    ? hardware.disks.reduce((sum, disk) => sum + (disk.capacityBytes ?? 0), 0)
    : null;
  requireValid(hardware.storageTotalBytes === total, 'storageTotalBytes');
}

function checkNetwork(hardware: Hardware): void {
  const dhcp = hardware.networks.some(adapter => adapter.mode === 'DHCP');
  const fixed = hardware.networks.some(adapter => adapter.mode === 'STATIC');
  const unknown = hardware.warnings.includes('NETWORK_ADAPTER_UNCLASSIFIED')
    || hardware.networks.some(adapter => adapter.mode === 'UNKNOWN');
  let expected: NetworkMode = 'UNKNOWN';
  if (dhcp && fixed) {
    expected = 'MIXED';
  } else if (!unknown && (dhcp || fixed)) {
    expected = dhcp ? 'DHCP' : 'STATIC';
  }
  requireValid(hardware.networkMode === expected, 'networkMode');
  const addresses = new Set(hardware.networks.flatMap(adapter => adapter.staticIpv4));
  requireValid(addresses.size === hardware.staticIpv4.length
    && hardware.staticIpv4.every(address => addresses.has(address)), 'staticIpv4');
}

function requireValid(valid: boolean, rule: string): asserts valid {
  if (!valid) {
    throw new TypeError('Invalid inventory data: ' + rule);
  }
}
