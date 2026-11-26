import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, unlink } from 'node:fs/promises';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const collections = ['computers', 'inventoryReports', 'locations', 'locationRenames'];
const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const backupFormat = 'pcinventory-firestore-v1';
const maxCommitBytes = 8 * 1024 * 1024;
const gcloudArgs = ['auth', 'print-access-token', '--quiet'];

function options(args) {
  const { positionals: [mode], positionals, values } = parseArgs({
    args, allowPositionals: true,
    options: { project: { type: 'string' }, file: { type: 'string' },
      emulator: { type: 'boolean' }, apply: { type: 'boolean' } },
  });
  if (positionals.length !== 1 || !['backup', 'restore'].includes(mode)
      || !projectPattern.test(values.project ?? '') || !values.file || (mode === 'backup' && values.apply)) {
    throw new Error('Используйте backup|restore --project PROJECT_ID --file PATH [--emulator] [--apply для restore].');
  }
  return { mode, ...values };
}

function accessToken() {
  const opts = { encoding: 'utf8', timeout: 30000, windowsHide: true };
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'gcloud ' + gcloudArgs.join(' ')], opts)
    : spawnSync('gcloud', gcloudArgs, opts);
  const token = result.stdout?.trim();
  if (result.status !== 0 || !token || /\s/.test(token)) {
    throw new Error('Не удалось получить токен Google Cloud CLI. Выполните gcloud auth login.');
  }
  return token;
}

function firestore({ project, emulator }) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    if (!/^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(host ?? '') || !project.startsWith('demo-')) {
      throw new Error('Для эмулятора укажите FIRESTORE_EMULATOR_HOST=127.0.0.1:PORT и проект demo-…');
    }
  } else if (host || project.startsWith('demo-')) {
    throw new Error('Для облачного режима уберите FIRESTORE_EMULATOR_HOST и укажите облачный Project ID.');
  }

  const base = emulator ? 'http://' + host : 'https://firestore.googleapis.com';
  const root = 'projects/' + project + '/databases/(default)/documents';
  let token = emulator ? 'owner' : accessToken();
  let refreshAt = Date.now() + 45 * 60 * 1000;
  async function request(path, data, label) {
    if (!emulator && Date.now() >= refreshAt) {
      token = accessToken();
      refreshAt = Date.now() + 45 * 60 * 1000;
    }
    const url = new URL('/v1/' + root + path, base);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: AbortSignal.timeout(60000),
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
    && Buffer.byteLength(id, 'utf8') <= 1500;
}

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const counts = inventory => Object.fromEntries(collections.map(name => [name, inventory[name].length]));

async function snapshot(db) {
  const readTime = await db.readTime();
  const entries = await Promise.all(collections.map(async name => [name, await db.list(name, readTime)]));
  return { readTime, inventory: Object.fromEntries(entries) };
}

async function writeBackup(file, payload) {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ payload, sha256: digest(payload) }, null, 2) + '\n', 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(file).catch(() => {});
    throw error;
  }
  await handle.close();
}

async function readBackup(file) {
  let envelope;
  try { envelope = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error('Не удалось прочитать JSON резервной копии.'); }
  const { payload, sha256 } = envelope ?? {};
  if (!payload || typeof sha256 !== 'string' || digest(payload) !== sha256) {
    throw new Error('Контрольная сумма резервной копии не совпадает.');
  }
  if (payload.format !== backupFormat || !projectPattern.test(payload.sourceProject ?? '')
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
      if (!target || !isDeepStrictEqual(row.fields, target.fields)) {
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
    const length = Buffer.byteLength(JSON.stringify(write), 'utf8') + 1;
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

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.mode === 'backup') {
    const { readTime, inventory } = await snapshot(firestore(opts));
    await writeBackup(opts.file, { format: backupFormat, sourceProject: opts.project, readTime, inventory });
    console.log(JSON.stringify({ операция: 'Копия сохранена', проект: opts.project, readTime, документы: counts(inventory) }));
    return;
  }

  const backup = await readBackup(opts.file);
  if (backup.sourceProject === opts.project) throw new Error('Для восстановления укажите другой проект.');
  const db = firestore(opts);
  const current = (await snapshot(db)).inventory;
  const missing = missingDocuments(backup.inventory, current);
  if (!opts.apply) {
    console.log(JSON.stringify({ операция: 'План восстановления', проект: opts.project,
      кСозданию: missing.length, вКопии: counts(backup.inventory) }));
    return;
  }

  let written = 0;
  try {
    const writes = missing.map(([name, row]) => db.write(name, row));
    for (const batch of batches(writes)) {
      await db.commit(batch);
      written += batch.length;
    }
    const restored = (await snapshot(db)).inventory;
    if (missingDocuments(backup.inventory, restored).length > 0) throw new Error('В целевой базе отсутствуют документы.');
  } catch (error) {
    throw new Error(error.message + ' Подтверждено записей в этом запуске: ' + written + '. Проверьте план перед повтором.');
  }
  console.log(JSON.stringify({ операция: 'Восстановление проверено', проект: opts.project,
    создано: written, документы: counts(backup.inventory) }));
}

main().catch(error => {
  console.error(error.code === 'EEXIST' ? 'Файл резервной копии уже существует. Выберите новый путь.' : error.message);
  process.exitCode = 1;
});
