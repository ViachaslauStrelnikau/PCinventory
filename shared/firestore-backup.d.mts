export type BackupCollection = 'computers' | 'inventoryReports' | 'locations' | 'locationRenames';
export type DocumentCounts = Record<BackupCollection, number>;
interface BackupDocument {
  id: string;
  fields: Record<string, unknown>;
}
export interface Backup {
  format: 'pcinventory-firestore-v1';
  sourceProject: string;
  readTime: string;
  inventory: Record<BackupCollection, BackupDocument[]>;
}
interface FirestoreConnection {
  project: string;
  base?: string;
  getToken: () => string | Promise<string>;
  signal?: AbortSignal;
}
declare const firestoreClient: unique symbol;
interface FirestoreClient {
  readonly project: string;
  readonly [firestoreClient]: true;
}
export interface RestorePlan {
  missingCount: number;
  missing: DocumentCounts;
  total: DocumentCounts;
}
export function validProjectId(project: unknown): project is string;
export function createFirestore(connection: FirestoreConnection): FirestoreClient;
export function counts(inventory: Backup['inventory']): DocumentCounts;
export function createBackup(db: FirestoreClient): Promise<Backup>;
export function encodeBackup(backup: Backup): Promise<string>;
export function decodeBackup(content: string): Promise<Backup>;
export function planRestore(db: FirestoreClient, backup: Backup): Promise<RestorePlan>;
export function restoreBackup(db: FirestoreClient, backup: Backup): Promise<{ written: number; total: DocumentCounts }>;
