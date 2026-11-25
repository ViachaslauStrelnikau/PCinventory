export function locationFields({ building, floor, room }) {
  return { building, floor, room };
}

export async function locationId({ building, floor, room }) {
  const bytes = new TextEncoder().encode(JSON.stringify([building, floor, room]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validLocation(value) {
  return validDirectoryLocation(value) && value.floor !== '' && value.room !== '';
}

const validName = (value, max) => typeof value === 'string' && value.length <= max && /[^\s\p{Z}\u0085\ufeff]/u.test(value);

export function validDirectoryLocation(value) {
  return value !== null && typeof value === 'object' && validName(value.building, 256)
    && (value.floor === '' ? value.room === '' : validName(value.floor, 64) && (value.room === '' || validName(value.room, 64)));
}

export function locationParents(value) {
  const parents = [{ building: value.building, floor: '', room: '' }];
  if (value.floor !== '') parents.push({ building: value.building, floor: value.floor, room: '' });
  if (value.room !== '') parents.push(locationFields(value));
  return parents;
}
