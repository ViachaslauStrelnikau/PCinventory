import { collection, doc, getDoc, getDocs, limit, query, runTransaction, serverTimestamp, Timestamp, where } from 'firebase/firestore/lite';
import type { Firestore, Transaction } from 'firebase/firestore/lite';
import { locationFields, locationId, locationParents, validDirectoryLocation,
  type InventoryLocation } from '../../../../shared/location-directory.mjs';

export type DirectoryCommand = { action: 'create'; path: InventoryLocation }
  | { action: 'delete'; path: InventoryLocation }
  | { action: 'rename'; path: InventoryLocation; name: string };

type StoredLocation = { id: string; location: InventoryLocation; roomId?: string };
type OldLocation = StoredLocation & { deleted: boolean };

function key({ building, floor, room }: InventoryLocation): string {
  return JSON.stringify([building, floor, room]);
}

function under(value: InventoryLocation, path: InventoryLocation): boolean {
  return value.building === path.building && (!path.floor || value.floor === path.floor)
    && (!path.room || value.room === path.room);
}

function directoryVersion(db: Firestore) {
  return doc(db, 'settings', 'locationVersion');
}

export function touchDirectory(transaction: Transaction, db: Firestore): void {
  transaction.set(directoryVersion(db), { updatedAt: serverTimestamp() });
}

export async function indexLocation(transaction: Transaction, db: Firestore, value: InventoryLocation): Promise<void> {
  const ids = await Promise.all(locationParents(value).map(locationId));
  const ref = doc(db, 'locations', ids.at(-1)!);
  const [current, ...aliases] = await Promise.all([
    transaction.get(ref), ...ids.map(id => transaction.get(doc(db, 'locationRenames', id))),
  ]);
  if (aliases.some(alias => alias.exists())) {
    throw new Error(aliases.some(alias => alias.get('kind') === 'DELETED') ? 'location-deleted' : 'location-renamed');
  }
  const stored = current.data();
  if (!stored) transaction.set(ref, locationFields(value));
  else if (!validDirectoryLocation(stored) || key(stored) !== key(value)) throw new Error('invalid-location');
  touchDirectory(transaction, db);
}

async function readDirectory(db: Firestore) {
  const [current, old] = await Promise.all([
    getDocs(collection(db, 'locations')), getDocs(collection(db, 'locationRenames')),
  ]);
  const entries: StoredLocation[] = [];
  const aliases: OldLocation[] = [];
  for (const item of current.docs) {
    const data = item.data();
    if (validDirectoryLocation(data)) {
      entries.push({ id: item.id, location: locationFields(data), roomId: item.get('roomId') });
    }
  }
  for (const item of old.docs) {
    const data = item.data();
    if (validDirectoryLocation(data)) {
      aliases.push({ id: item.id, location: locationFields(data), roomId: item.get('roomId'),
        deleted: item.get('kind') === 'DELETED' });
    }
  }
  return { entries, aliases };
}

function resolver(entries: StoredLocation[], aliases: OldLocation[]) {
  const current = new Map(entries.filter(item => item.location.room)
    .map(item => [item.roomId ?? item.id, item.location]));
  const old = new Map(aliases.filter(item => item.roomId && !item.deleted)
    .map(item => [key(item.location), current.get(item.roomId!)]));
  return (value: InventoryLocation) => old.get(key(value)) ?? locationFields(value);
}

export async function loadDirectory(db: Firestore) {
  const { entries, aliases } = await readDirectory(db);
  return { locations: entries.map(item => item.location), resolve: resolver(entries, aliases) };
}

export async function resolveCardLocation(db: Firestore, location: InventoryLocation): Promise<InventoryLocation> {
  const alias = await getDoc(doc(db, 'locationRenames', await locationId(location)));
  const roomId = alias.get('roomId');
  if (!roomId) return locationFields(location);
  const matches = await getDocs(query(collection(db, 'locations'), where('roomId', '==', roomId), limit(1)));
  const data = matches.docs[0]?.data();
  return validDirectoryLocation(data) ? locationFields(data) : locationFields(location);
}

export async function changeDirectory(db: Firestore, command: DirectoryCommand): Promise<void> {
  const { action, path } = command;
  if (!validDirectoryLocation(path)) throw new Error('invalid-location');
  const versionRef = directoryVersion(db);
  // A version read before the queries lets the transaction detect concurrent changes to their results.
  const version: Timestamp | undefined = (await getDoc(versionRef)).get('updatedAt');
  const [{ entries, aliases }, cardDocs] = await Promise.all([readDirectory(db), getDocs(collection(db, 'computers'))]);
  const resolve = resolver(entries, aliases);
  const storedLocations = cardDocs.docs.map(card => card.data()).filter(validDirectoryLocation);
  const savedPaths = new Set(storedLocations.map(key));
  const cardLocations = storedLocations.map(resolve);
  const keys = new Set([...entries.map(item => item.location), ...cardLocations].flatMap(locationParents).map(key));
  const sourceId = await locationId(path);
  const parent = locationParents(path).at(-2);
  const current = entries.find(item => key(item.location) === key(path));
  const currentRef = doc(db, 'locations', sourceId);
  const oldRef = doc(db, 'locationRenames', sourceId);

  const writes: ((transaction: Transaction) => void)[] = [];
  if (action === 'create') {
    if (keys.has(key(path))) throw new Error('location-exists');
    if (parent && !keys.has(key(parent))) throw new Error('parent-location-missing');
    const historical = aliases.find(item => item.id === sourceId);
    if (historical?.roomId && savedPaths.has(key(path))) throw new Error('historical-location');
    if (historical) writes.push(transaction => transaction.delete(oldRef));
    writes.push(transaction => transaction.set(currentRef, path));
  } else {
    if (!keys.has(key(path))) throw new Error('location-missing');
    if (action === 'delete') {
      if (cardLocations.some(location => under(location, path))) throw new Error('location-in-use');
      if (entries.some(item => key(path) !== key(item.location) && under(item.location, path))) {
        throw new Error('location-has-children');
      }
      if (!current) throw new Error('location-missing');
      for (const ancestor of locationParents(path).slice(0, -1)) {
        if (!entries.some(item => key(item.location) === key(ancestor))) {
          const id = await locationId(ancestor);
          writes.push(transaction => transaction.set(doc(db, 'locations', id), ancestor));
        }
      }
      writes.push(transaction => transaction.delete(currentRef));
      writes.push(transaction => transaction.set(oldRef, { ...path, kind: 'DELETED' }));
    } else {
      const level = path.room ? 'room' : path.floor ? 'floor' : 'building';
      if (command.name === path[level]) return;
      const destination = { ...path, [level]: command.name };
      if (!validDirectoryLocation(destination) || !command.name) throw new Error('invalid-location');
      if (keys.has(key(destination))) throw new Error('location-exists');
      const sources = new Map(entries.filter(item => under(item.location, path)).map(item => [key(item.location), item]));
      for (const location of cardLocations.filter(item => under(item, path))) {
        if (!sources.has(key(location))) sources.set(key(location), { id: await locationId(location), location });
      }
      const aliasesByPath = new Map(aliases.map(item => [key(item.location), item]));
      for (const item of sources.values()) {
        const next = { ...item.location, [level]: command.name };
        const nextId = await locationId(next);
        const roomId = item.roomId ?? item.id;
        const historical = aliasesByPath.get(key(next));
        if (historical?.roomId && historical.roomId !== roomId && savedPaths.has(key(next))) {
          throw new Error('historical-location');
        }
        if (historical) writes.push(transaction => transaction.delete(doc(db, 'locationRenames', nextId)));
        if (item.location.room) {
          writes.push(transaction => transaction.set(doc(db, 'locationRenames', item.id), { ...item.location, roomId }));
        }
        writes.push(transaction => transaction.delete(doc(db, 'locations', item.id)));
        writes.push(transaction => transaction.set(doc(db, 'locations', nextId), item.location.room ? { ...next, roomId } : next));
      }
      if (!path.room) {
        writes.push(transaction => transaction.set(oldRef, path));
        const historical = aliasesByPath.get(key(destination));
        if (historical && !sources.has(key(path))) {
          writes.push(transaction => transaction.delete(doc(db, 'locationRenames', historical.id)));
        }
      }
      // Keep stale report addresses blocked after moving the parent.
      for (const item of aliases.filter(item => item.deleted && under(item.location, path))) {
        const next = { ...item.location, [level]: command.name };
        if (aliasesByPath.get(key(next))?.roomId) continue;
        const nextId = await locationId(next);
        writes.push(transaction => transaction.set(doc(db, 'locationRenames', nextId), { ...next, kind: 'DELETED' }));
      }
    }
  }

  if (writes.length > 400) throw new Error('rename-limit');
  await runTransaction(db, async transaction => {
    const latest: Timestamp | undefined = (await transaction.get(versionRef)).get('updatedAt');
    if (version ? !latest?.isEqual(version) : latest !== undefined) throw new Error('concurrent-update');
    for (const write of writes) write(transaction);
    touchDirectory(transaction, db);
  });
}
