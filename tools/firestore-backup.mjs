import { spawnSync } from 'node:child_process';
import { open, readFile, unlink } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { counts, createBackup, createFirestore, decodeBackup, encodeBackup, planRestore, restoreBackup,
  validProjectId } from '../shared/firestore-backup.mjs';

const gcloudArgs = ['auth', 'print-access-token', '--quiet'];

function options(args) {
  const { positionals: [mode], positionals, values } = parseArgs({
    args, allowPositionals: true,
    options: { project: { type: 'string' }, file: { type: 'string' },
      emulator: { type: 'boolean' }, apply: { type: 'boolean' } },
  });
  if (positionals.length !== 1 || !['backup', 'restore'].includes(mode)
      || !validProjectId(values.project) || !values.file || (mode === 'backup' && values.apply)) {
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
    return createFirestore({ project, base: 'http://' + host, getToken: () => 'owner' });
  }
  if (host || project.startsWith('demo-')) {
    throw new Error('Для облачного режима уберите FIRESTORE_EMULATOR_HOST и укажите облачный Project ID.');
  }
  let token;
  let refreshAt = 0;
  return createFirestore({ project, getToken() {
    if (Date.now() >= refreshAt) {
      token = accessToken();
      refreshAt = Date.now() + 45 * 60 * 1000;
    }
    return token;
  } });
}

async function writeBackup(file, content) {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(file).catch(() => {});
    throw error;
  }
  await handle.close();
}


async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.mode === 'backup') {
    const backup = await createBackup(firestore(opts));
    await writeBackup(opts.file, await encodeBackup(backup));
    console.log(JSON.stringify({ операция: 'Копия сохранена', проект: opts.project,
      readTime: backup.readTime, документы: counts(backup.inventory) }));
    return;
  }

  const content = await readFile(opts.file, 'utf8').catch(() => {
    throw new Error('Не удалось прочитать файл резервной копии.');
  });
  const backup = await decodeBackup(content);
  const db = firestore(opts);
  if (!opts.apply) {
    const plan = await planRestore(db, backup);
    console.log(JSON.stringify({ операция: 'План восстановления', проект: opts.project,
      кСозданию: plan.missingCount, вКопии: plan.total }));
    return;
  }

  const result = await restoreBackup(db, backup);
  console.log(JSON.stringify({ операция: 'Восстановление проверено', проект: opts.project,
    создано: result.written, документы: result.total }));
}

main().catch(error => {
  console.error(error.code === 'EEXIST' ? 'Файл резервной копии уже существует. Выберите новый путь.' : error.message);
  process.exitCode = 1;
});
