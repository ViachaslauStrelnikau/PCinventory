import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { locationFields, locationId, locationParents, validLocation } from '../../shared/location-directory.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(host ?? '')) {
  throw new Error('Set FIRESTORE_EMULATOR_HOST to the local emulator.');
}
initializeApp({ projectId: 'demo-pcinventory' });
const db = getFirestore();
const [cards, aliases] = await Promise.all([db.collection('computers').get(), db.collection('locationRenames').get()]);
const oldIds = new Set(aliases.docs.map(alias => alias.id));
const locations = new Map();
for (const card of cards.docs) {
  const value = card.data();
  if (!validLocation(value)) continue;
  const ids = await Promise.all(locationParents(value).map(locationId));
  if (!ids.some(id => oldIds.has(id))) locations.set(ids.at(-1), locationFields(value));
}
const writer = db.bulkWriter();
let added = 0;
const writes = Promise.all([...locations].map(async ([id, fields]) => {
  try {
    await writer.create(db.collection('locations').doc(id), fields);
    added++;
  } catch (error) {
    if (error.code !== 6) throw error;
  }
}));
await Promise.all([writer.close(), writes]);
console.log(JSON.stringify({ cards: cards.size, locations: locations.size, added }));
