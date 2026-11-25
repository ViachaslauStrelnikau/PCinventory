import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { locationFields, locationId, locationParents, validDirectoryLocation } from './location-directory.mjs';

function under(collection, { building, floor, room }) {
  const buildingQuery = collection.where('building', '==', building);
  if (!floor) return buildingQuery;
  const floorQuery = buildingQuery.where('floor', '==', floor);
  return room ? floorQuery.where('room', '==', room) : floorQuery;
}

function pathOf(value, trim = false) {
  if (!value || typeof value !== 'object' || !['building', 'floor', 'room'].every(key => typeof value[key] === 'string')) {
    throw new HttpsError('invalid-argument', 'invalid-location');
  }
  const path = trim
    ? { building: value.building.trim(), floor: value.floor.trim(), room: value.room.trim() }
    : locationFields(value);
  if (!validDirectoryLocation(path)) throw new HttpsError('invalid-argument', 'invalid-location');
  return path;
}

async function writeLocation(transaction, directories, renames, path) {
  const id = await locationId(path);
  const existing = await transaction.get(under(directories, path).limit(1));
  if (!existing.empty) throw new HttpsError('already-exists', 'location-exists');
  const parents = locationParents(path);
  if (parents.length > 1 && (await transaction.get(under(directories, parents.at(-2)).limit(1))).empty) {
    throw new HttpsError('failed-precondition', 'parent-location-missing');
  }
  const oldName = await transaction.get(renames.doc(id));
  if (oldName.exists) transaction.delete(oldName.ref);
  transaction.create(directories.doc(id), path);
}

async function renameLocation(transaction, collections, source, destination, uid) {
  const { directories, renames, computers } = collections;
  const [previous, cards, oldNames, next, destinationCards] = await Promise.all([
    transaction.get(under(directories, source)), transaction.get(under(computers, source)),
    transaction.get(under(renames, source)), transaction.get(under(directories, destination).limit(1)),
    transaction.get(under(computers, destination).limit(1)),
  ]);
  if (previous.empty && cards.empty) throw new HttpsError('not-found', 'location-missing');
  if (!next.empty || !destinationCards.empty) throw new HttpsError('already-exists', 'location-exists');

  const sourceId = await locationId(source);
  const destinationId = await locationId(destination);
  const exactPreviousName = await transaction.get(renames.doc(destinationId));
  const replace = value => ({ ...locationFields(value),
    building: destination.building, floor: source.floor ? destination.floor : value.floor,
    room: source.room ? destination.room : value.room });
  const locations = new Map();
  for (const item of [...previous.docs, ...cards.docs]) {
    const path = replace(item.data());
    locations.set(await locationId(path), path);
  }
  const movedNames = new Map();
  for (const item of oldNames.docs) {
    const stored = item.data();
    const path = replace(stored);
    movedNames.set(await locationId(path), stored.kind === 'DELETED' ? { ...path, kind: stored.kind } : path);
  }
  // A deliberately restored name takes precedence over an old marker.
  movedNames.delete(destinationId);
  for (const item of previous.docs) transaction.delete(item.ref);
  for (const item of oldNames.docs) transaction.delete(item.ref);
  if (exactPreviousName.exists) transaction.delete(exactPreviousName.ref);
  for (const [id, path] of movedNames) transaction.set(renames.doc(id), path);
  transaction.set(renames.doc(sourceId), source);
  for (const [id, path] of locations) transaction.create(directories.doc(id), path);
  for (const card of cards.docs) {
    transaction.update(card.ref, { ...replace(card.data()), assignmentUpdatedBy: uid,
      assignmentUpdatedAt: FieldValue.serverTimestamp() });
  }
  return { updatedCards: cards.size };
}

async function deleteLocation(transaction, { directories, renames, computers }, path) {
  const parents = locationParents(path);
  const ids = await Promise.all(parents.map(locationId));
  const id = ids.pop();
  const [current, children, cards, ...ancestors] = await Promise.all([
    transaction.get(directories.doc(id)), transaction.get(under(directories, path).limit(2)),
    transaction.get(under(computers, path).limit(1)),
    ...ids.map(parent => transaction.get(directories.doc(parent))),
  ]);
  if (!cards.empty) throw new HttpsError('failed-precondition', 'location-in-use');
  if (children.docs.some(child => child.id !== id)) {
    throw new HttpsError('failed-precondition', 'location-has-children');
  }
  if (!current.exists) throw new HttpsError('not-found', 'location-missing');

  // A parent previously inferred from its last child becomes an explicit entry.
  ancestors.forEach((ancestor, index) => {
    if (!ancestor.exists) transaction.create(ancestor.ref, parents[index]);
  });
  transaction.delete(current.ref);
  transaction.set(renames.doc(id), { ...path, kind: 'DELETED' });
}

export const manageLocations = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'sign-in-required');
  const db = getFirestore();
  const uid = request.auth.uid;
  const actor = db.collection('users').doc(uid);
  const action = request.data?.action;
  if (action !== 'create' && action !== 'rename' && action !== 'delete') {
    throw new HttpsError('invalid-argument', 'invalid-location');
  }
  const source = pathOf(request.data?.path, action === 'create');
  const key = source.room ? 'room' : source.floor ? 'floor' : 'building';
  const name = typeof request.data?.name === 'string' ? request.data.name.trim() : '';
  const destination = action === 'rename' ? pathOf({ ...source, [key]: name }) : null;
  if (destination && !destination[key]) throw new HttpsError('invalid-argument', 'invalid-location');
  const collections = { directories: db.collection('locations'), renames: db.collection('locationRenames'), computers: db.collection('computers') };
  try {
    return await db.runTransaction(async transaction => {
      const profile = (await transaction.get(actor)).data();
      if (profile?.role !== 'ADMIN' || profile.enabled !== true) {
        throw new HttpsError('permission-denied', 'admin-required');
      }
      if (action === 'create') {
        await writeLocation(transaction, collections.directories, collections.renames, source);
        return { updatedCards: 0 };
      }
      if (action === 'delete') {
        await deleteLocation(transaction, collections, source);
        return { updatedCards: 0 };
      }
      if (source[key] === destination[key]) return { updatedCards: 0 };
      return renameLocation(transaction, collections, source, destination, uid);
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error.code === 10) throw new HttpsError('aborted', 'concurrent-update');
    if (error.code === 8 || error.code === 3) throw new HttpsError('resource-exhausted', 'rename-limit');
    console.error('Location update failed', { code: error.code ?? 'unknown' });
    throw new HttpsError('internal', 'location-operation-failed');
  }
});
