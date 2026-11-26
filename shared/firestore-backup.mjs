function equalFields(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
      || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equalFields(left[key], right[key]));
}

const collections = ['computers', 'inventoryReports', 'locations', 'locationRenames'];
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const backupFormat = 'pcinventory-firestore-v1';
const maxCommitBytes = 8 * 1024 * 1024;
const encoder = new TextEncoder();

const cloudFirestore = 'https://firestore.googleapis.com';

export function validProjectId(project) {
  return typeof project === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project);
}

export function createFirestore({ project, base = cloudFirestore, getToken, signal }) {
  if (!validProjectId(project)) throw new Error('Укажите действительный Project ID.');
  const root = 'projects/' + project + '/databases/(default)/documents';
  async function request(path, data, label) {
    const token = await getToken();
    const url = new URL('/v1/' + root + path, base);
    const timeout = AbortSignal.timeout(60000);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new Error(label + ' — ошибка соединения с Firestore.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(label + ' — Firestore вернул HTTP ' + response.status + '.');
    }
    return response.json();
  }

  return {
    project,
    async readTime() {
      // A missing settings document also returns a Firestore server read time.
      const reply = await request(':batchGet', {
        documents: [root + '/settings/inventory'], mask: { fieldPaths: ['acceptingReports'] },
      }, 'Получение времени снимка');
      const time = reply[0]?.readTime?.replace(/(\.\d{6})\d+Z$/, '$1Z');
      if (!timestampPattern.test(time ?? '')) throw new Error('Firestore не вернул время снимка.');
      return time;
    },

    async list(collection, readTime) {
      const docs = [];
      const prefix = root + '/' + collection + '/';
      const limit = 100;
      const seen = new Set();
      let cursor;
      while (true) {
        const structuredQuery = { from: [{ collectionId: collection }], limit,
          orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] };
        if (cursor) structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
        const reply = await request(':runQuery', { structuredQuery, readTime }, 'Чтение ' + collection);
        const page = reply.filter(row => row.document).map(row => row.document);
        for (const row of page) {
          const id = row.name?.startsWith(prefix) ? row.name.slice(prefix.length) : '';
          if (!validId(id) || seen.has(id)) throw new Error('Firestore вернул повторяющийся или недопустимый документ.');
          seen.add(id);
          docs.push({ id, fields: row.fields ?? {} });
        }
        if (page.length < limit) break;
        cursor = page.at(-1).name;
      }
      return docs;
    },

    async commit(writes) {
      await request(':commit', { writes }, 'Запись пакета');
    },

    write(collection, doc) {
      return { update: { name: root + '/' + collection + '/' + doc.id, fields: doc.fields },
        currentDocument: { exists: false } };
    },
  };
}

function validId(id) {
  return typeof id === 'string' && id !== '' && id !== '.' && id !== '..'
    && !id.includes('/') && !/[\u0000-\u001F]/.test(id) && !/^__.*__$/.test(id)
    && encoder.encode(id).byteLength <= 1500;
}

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
async function digest(value) {
  const bytes = encoder.encode(JSON.stringify(value));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}
export const counts = inventory => Object.fromEntries(collections.map(name => [name, inventory[name].length]));

async function snapshot(db) {
  const readTime = await db.readTime();
  const entries = await Promise.all(collections.map(async name => [name, await db.list(name, readTime)]));
  return { readTime, inventory: Object.fromEntries(entries) };
}


export async function createBackup(db) {
  return { format: backupFormat, sourceProject: db.project, ...(await snapshot(db)) };
}

export async function encodeBackup(payload) {
  return JSON.stringify({ payload, sha256: await digest(payload) }, null, 2) + '\n';
}

export async function decodeBackup(content) {
  let envelope;
  try { envelope = JSON.parse(content); }
  catch { throw new Error('Не удалось прочитать JSON резервной копии.'); }
  const { payload, sha256 } = envelope ?? {};
  if (!payload || typeof sha256 !== 'string' || (await digest(payload)) !== sha256) {
    throw new Error('Контрольная сумма резервной копии не совпадает.');
  }
  if (payload.format !== backupFormat || !validProjectId(payload.sourceProject)
      || !timestampPattern.test(payload.readTime ?? '') || !isMap(payload.inventory)
      || Object.keys(payload.inventory).length !== collections.length) {
    throw new Error('Неизвестный формат резервной копии.');
  }
  for (const name of collections) {
    const rows = payload.inventory[name];
    const seen = new Set();
    if (!Array.isArray(rows)) throw new Error('В копии отсутствует коллекция ' + name + '.');
    for (const row of rows) {
      if (!row || !validId(row.id) || !isMap(row.fields) || seen.has(row.id)) {
        throw new Error('Неверные или повторяющиеся документы в коллекции ' + name + '.');
      }
      seen.add(row.id);
    }
  }
  return payload;
}

function missingDocuments(expected, current) {
  const missing = [];
  for (const name of collections) {
    const wanted = new Map(expected[name].map(row => [row.id, row]));
    for (const row of current[name]) {
      const target = wanted.get(row.id);
      if (!target || !equalFields(row.fields, target.fields)) {
        throw new Error('Целевая коллекция ' + name + ' содержит данные, которых нет в этой копии или которые отличаются.');
      }
      wanted.delete(row.id);
    }
    for (const row of wanted.values()) missing.push([name, row]);
  }
  return missing;
}

function* batches(writes) {
  let batch = [];
  let bytes = 32;
  for (const write of writes) {
    const length = encoder.encode(JSON.stringify(write)).byteLength + 1;
    if (length + 32 > maxCommitBytes) throw new Error('Документ слишком велик для восстановления.');
    if (batch.length === 100 || bytes + length > maxCommitBytes) {
      yield batch;
      batch = [];
      bytes = 32;
    }
    batch.push(write);
    bytes += length;
  }
  if (batch.length) yield batch;
}


async function prepareRestore(db, backup) {
  if (backup.sourceProject === db.project) throw new Error('Для восстановления укажите другой проект.');
  return missingDocuments(backup.inventory, (await snapshot(db)).inventory);
}

export async function planRestore(db, backup) {
  return countsForRestore(await prepareRestore(db, backup), backup.inventory);
}

function countsForRestore(missing, inventory) {
  const remaining = Object.fromEntries(collections.map(name => [name, 0]));
  for (const [name] of missing) remaining[name]++;
  return { missingCount: missing.length, missing: remaining, total: counts(inventory) };
}

export async function restoreBackup(db, backup) {
  const missing = await prepareRestore(db, backup);
  let written = 0;
  try {
    for (const batch of batches(missing.map(([name, row]) => db.write(name, row)))) {
      await db.commit(batch);
      written += batch.length;
    }
    const restored = (await snapshot(db)).inventory;
    if (missingDocuments(backup.inventory, restored).length > 0) throw new Error('В целевой базе отсутствуют документы.');
  } catch (error) {
    throw new Error(error.message + ' Подтверждено записей в этом запуске: ' + written + '. Проверьте план перед повтором.');
  }
  return { written, total: counts(backup.inventory) };
}
