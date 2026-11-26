export type InventoryLocation = { building: string; floor: string; room: string };
export function locationFields(value: InventoryLocation): InventoryLocation;
export function locationId(value: InventoryLocation): Promise<string>;
export function validLocation(value: unknown): value is InventoryLocation;
export function validDirectoryLocation(value: unknown): value is InventoryLocation;
export function locationParents(value: InventoryLocation): InventoryLocation[];
