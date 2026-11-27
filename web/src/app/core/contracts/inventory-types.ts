export type AgentIdentitySource = 'SMBIOS' | 'LOCAL';
export type IdentitySource = AgentIdentitySource | 'MANUAL';
export type InventoryRole = 'COLLECTOR' | 'ADMIN' | 'USER';
export type RamSlotTopology = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
export type RamTechnology =
  | 'DDR' | 'DDR2' | 'DDR2 FB-DIMM' | 'DDR3' | 'DDR4' | 'DDR5'
  | 'LPDDR' | 'LPDDR2' | 'LPDDR3' | 'LPDDR4' | 'LPDDR5';
export type DiskType = 'SSD' | 'HDD' | 'UNKNOWN';
export type AdapterMode = 'DHCP' | 'STATIC' | 'UNKNOWN';
export type NetworkMode = AdapterMode | 'MIXED';

export type WarningCode =
  | 'CPU_ATTRIBUTES_UNAVAILABLE'
  | 'SYSTEM_ATTRIBUTES_UNAVAILABLE'
  | 'OS_ATTRIBUTES_UNAVAILABLE'
  | 'GPU_ATTRIBUTES_UNAVAILABLE'
  | 'RAM_MODULES_UNAVAILABLE'
  | 'RAM_CAPACITY_OS_VISIBLE'
  | 'RAM_SLOT_TOPOLOGY_PARTIAL'
  | 'RAM_SOURCE_CONFLICT'
  | 'RAM_SPEED_UNAVAILABLE'
  | 'DISK_ATTRIBUTES_UNAVAILABLE'
  | 'DISK_TYPES_UNAVAILABLE'
  | 'NETWORK_MODE_UNAVAILABLE'
  | 'NETWORK_ADAPTER_UNCLASSIFIED'
  | 'STATIC_IPV4_UNAVAILABLE'
  | 'IDENTITY_PROFILE_FALLBACK';

export interface ContractTimestamp {
  seconds: number;
  nanoseconds: number;
}

export interface Gpu {
  model: string | null;
  manufacturer: string | null;
  vramBytes: number | null;
}

export interface RamSlot {
  slotId: string | null;
  bankLabel: string | null;
  occupied: boolean | null;
  capacityBytes: number | null;
  memoryType: RamTechnology | null;
  speedMtps: number | null;
  configuredSpeedMtps: number | null;
  manufacturer: string | null;
  partNumber: string | null;
  formFactor: string | null;
}

export interface Disk {
  model: string | null;
  type: DiskType;
  capacityBytes: number | null;
  interface: string | null;
}

export interface NetworkAdapter {
  name: string | null;
  mode: AdapterMode;
  staticIpv4: string[];
}

export interface Hardware {
  schemaVersion: 1;
  agentVersion: string;
  identitySource: IdentitySource;
  hostname: string;

  cpuManufacturer: string | null;
  cpuModel: string | null;
  cpuModelRaw: string | null;
  cpuCores: number | null;
  cpuThreads: number | null;
  motherboardManufacturer: string | null;
  motherboardModel: string | null;
  motherboardSerial: string | null;
  computerManufacturer: string | null;
  computerModel: string | null;
  deviceType?: 'LAPTOP' | 'DESKTOP' | 'UNKNOWN';
  osName: string | null;
  osVersion: string | null;
  osBuild: string | null;
  osArchitecture: 'x86' | 'x64' | null;

  gpuModels: string[];
  gpus: Gpu[];
  ramTotalBytes: number | null;
  ramTotalGiB: number | null;
  ramType: RamTechnology | 'MIXED' | 'UNKNOWN';
  ramSlotsTotal: number | null;
  ramSlotsUsed: number | null;
  ramSlotsFree: number | null;
  ramSlotTopology: RamSlotTopology;
  ramSlots: RamSlot[];

  storageTotalBytes: number | null;
  hasSsd: boolean | null;
  disks: Disk[];
  networkMode: NetworkMode;
  staticIpv4: string[];
  networks: NetworkAdapter[];
  warnings: WarningCode[];
}

export interface Assignment {
  building: string;
  floor: string;
  room: string;
  inventoryNumber?: string;
  employeeName?: string;
  department?: string;
  comment?: string;
}

export type InventoryReport = {
  reportId: string;
  deviceId: string;
  hardware: AgentHardware;
  assignment: Assignment;
  submittedAt: ContractTimestamp;
  submittedBy: string;
  correction?: {
    hardware: AgentHardware;
    assignment: Assignment;
    updatedAt: ContractTimestamp;
    updatedBy: string;
  };
} & (
  | { status: 'PENDING'; reviewedAt?: never; reviewedBy?: never }
  | { status: 'ACCEPTED' | 'REJECTED'; reviewedAt: ContractTimestamp; reviewedBy: string }
);

type AgentHardware = Hardware & { identitySource: AgentIdentitySource };

export type ComputerDocument = Required<Assignment> & {
  deviceId: string;
  assignmentUpdatedAt: ContractTimestamp;
  assignmentUpdatedBy: string;
} & (
  | (AgentHardware & { status?: 'ACTIVE' | 'RETIRED'; lastReportId: string; lastInventoryAt: ContractTimestamp })
  | (Hardware & { identitySource: 'MANUAL'; agentVersion: 'manual'; status: 'ACTIVE' | 'RETIRED';
      lastReportId: null; lastInventoryAt: null })
);
