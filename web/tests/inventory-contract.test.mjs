import assert from 'node:assert/strict';
import test from 'node:test';
import cases from '../../contracts/fixtures/cases.json' with { type: 'json' };
import pending from '../../contracts/fixtures/pending-report.json' with { type: 'json' };
import partial from '../../contracts/fixtures/partial-report.json' with { type: 'json' };
import accepted from '../../contracts/fixtures/accepted-report.json' with { type: 'json' };
import computer from '../../contracts/fixtures/computer.json' with { type: 'json' };
import { readComputer, readReport } from '../src/app/core/contracts/inventory-contract.ts';

const sources = { pending, partial, accepted, computer };
for (const fixture of cases) {
  test(fixture.name, () => {
    const document = structuredClone(sources[fixture.source]);
    for (const change of fixture.changes) {
      const path = change.path.slice(1).split('/');
      const last = path.pop();
      const parent = path.reduce((object, part) => object[part], document);
      if (Object.hasOwn(change, 'value')) {
        parent[last] = change.value;
      } else {
        delete parent[last];
      }
    }
    const read = fixture.source === 'computer' ? readComputer : readReport;
    if (fixture.expected === null) {
      assert.deepEqual(read(document), document);
    } else {
      assert.throws(() => read(document), { message: 'Invalid inventory data: ' + fixture.expected });
    }
  });
}

test('reads different module sizes and retains leading zeros', () => {
  const report = readReport(pending);
  assert.equal(report.assignment.inventoryNumber, '000123');
  assert.equal(report.assignment.room, '010');
  assert.equal(report.hardware.ramSlots[1].capacityBytes, 8 * 1024 ** 3);
  assert.equal(report.hardware.ramSlots[3].capacityBytes, 16 * 1024 ** 3);
  assert.equal(report.hardware.ramSlots[3].speedMtps, null);
});

test('rejects a structurally valid report over 64 KiB', () => {
  const document = structuredClone(pending);
  const label = '\u{1F5A5}'.repeat(256);
  const disk = { ...document.hardware.disks[0], model: label, interface: label };
  document.hardware.disks = Array.from({ length: 64 }, () => ({ ...disk }));
  document.hardware.storageTotalBytes = 64 * disk.capacityBytes;
  assert.throws(() => readReport(document), { message: 'Invalid inventory data: report exceeds 64 KiB' });
});
