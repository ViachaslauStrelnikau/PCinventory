import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';

const cli = fileURLToPath(new URL('../../tools/firestore-backup.mjs', import.meta.url));
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host ?? '', /^127\.0\.0\.1:[1-9][0-9]{0,4}$/);
const root = project => 'projects/' + project + '/databases/(default)/documents';

function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--emulator'], {
    encoding: 'utf8', timeout: 90000,
  });
  assert.ifError(result.error);
  return result;
}

function success(...args) {
  const reply = run(...args);
  assert.equal(reply.status, 0, reply.stderr);
  return JSON.parse(reply.stdout);
}

async function firestore(project, operation, payload) {
  const response = await fetch('http://' + host + '/v1/' + root(project) + operation, {
    method: payload ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, 'Firestore emulator request returned ' + response.status);
  return response.json();
}

const text = stringValue => ({ stringValue });
const int = integerValue => ({ integerValue });
const boolean = booleanValue => ({ booleanValue });
const date = { timestampValue: '2026-11-26T06:27:00.123456Z' };

async function seed(project, documents) {
  await firestore(project, ':commit', { writes: documents.map(([path, fields]) => ({
    update: { name: root(project) + '/' + path, fields },
  })) });
}

test('backs up linked inventory data and restores only missing records in another project', async () => {
  const suffix = randomUUID().slice(0, 8);
  const source = 'demo-copy-' + suffix;
  const target = 'demo-recovery-' + suffix;
  const temporarily = await mkdtemp(join(tmpdir(), 'pcinventory-backup-'));
  const copy = join(temporarily, 'sample.pcinventory-backup.json');
  const tampered = join(temporarily, 'tampered.pcinventory-backup.json');
  const card = { status: text('RETIRED'), lastReportId: text('test-report'), lastInventoryAt: date,
    building: text('Тестовый корпус'), floor: text('02'), room: text('007') };
  const room = { building: card.building, floor: card.floor, room: card.room };
  const report = { status: text('ACCEPTED'), deviceId: text('test-pc'), submittedAt: date,
    hardware: { mapValue: { fields: { ram: int('9007199254740993') } } } };
  try {
    await seed(source, [
      ['computers/test-pc', card], ['inventoryReports/test-report', report],
      ['locationRenames/former-room', { ...room, room: text('006') }],
      ['settings/inventory', { acceptingReports: boolean(true) }],
      ['users/test-admin', { role: text('ADMIN'), enabled: boolean(true) }],
      ...Array.from({ length: 102 }, (_, i) => ['locations/place-' + i, { ...room, room: text('007-' + i) }]),
    ]);
    await seed(target, [['computers/test-pc', card], ['settings/inventory', { acceptingReports: boolean(false) }]]);
    const backupArgs = ['backup', '--project', source, '--file', copy];
    const backup = success(...backupArgs);
    assert.deepEqual(backup.документы, { computers: 1, inventoryReports: 1, locations: 102, locationRenames: 1 });
    assert.equal(run(...backupArgs).status, 1);

    const plan = ['restore', '--project', target, '--file', copy];
    assert.equal(success(...plan).кСозданию, 104);
    assert.equal((await firestore(target, '/inventoryReports')).documents?.length ?? 0, 0);
    assert.equal(run('restore', '--project', source, '--file', copy, '--apply').status, 1);

    const original = await readFile(copy, 'utf8');
    await writeFile(tampered, original.replace('test-report', 'wrong-report'), 'utf8');
    assert.match(run('restore', '--project', target, '--file', tampered, '--apply').stderr, /Контрольная сумма/);

    assert.equal(success(...plan, '--apply').создано, 104);
    assert.equal(success(...plan, '--apply').создано, 0);
    const restored = await firestore(target, '/inventoryReports/test-report');
    assert.equal(restored.fields.deviceId.stringValue, 'test-pc');
    assert.equal(restored.fields.submittedAt.timestampValue, date.timestampValue);
    assert.equal(restored.fields.hardware.mapValue.fields.ram.integerValue, '9007199254740993');
    assert.deepEqual((await firestore(target, '/computers/test-pc')).fields, card);
    assert.equal((await firestore(target, '/settings/inventory')).fields.acceptingReports.booleanValue, false);
    assert.equal((await firestore(target, '/users')).documents?.length ?? 0, 0);

    await seed(target, [['locations/unrelated', room]]);
    assert.match(run(...plan, '--apply').stderr, /содержит данные/);
  } finally {
    await Promise.all([copy, tampered].map(file => unlink(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    })));
    await rmdir(temporarily);
  }
});
