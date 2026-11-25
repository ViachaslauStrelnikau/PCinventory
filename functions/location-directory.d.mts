export type InventoryLocation = { building: string; floor: string; room: string };
export function locationFields(value: InventoryLocation): InventoryLocation;
export function locationId(value: InventoryLocation): Promise<string>;
export function validLocation(value: unknown): value is InventoryLocation;
