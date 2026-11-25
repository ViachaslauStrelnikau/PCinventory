export function locationFields({ building, floor, room }) {
  return { building, floor, room };
}

export async function locationId({ building, floor, room }) {
  const bytes = new TextEncoder().encode(JSON.stringify([building, floor, room]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validLocation(value) {
  return value !== null && typeof value === 'object'
    && [[value.building, 256], [value.floor, 64], [value.room, 64]]
      .every(([text, max]) => typeof text === 'string' && /[^\s\p{Z}\u0085\ufeff]/u.test(text) && text.length <= max);
}
