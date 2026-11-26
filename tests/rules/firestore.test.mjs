import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import {
  Timestamp, collection, connectFirestoreEmulator, deleteDoc, deleteField, doc, getDocFromServer,
  getDocsFromServer, getFirestore, query, runTransaction, serverTimestamp, setDoc, setLogLevel, updateDoc,
  where, writeBatch,
} from 'firebase/firestore';
import pendingFixture from '../../contracts/fixtures/pending-report.json' with { type: 'json' };
import { locationId } from '../../functions/location-directory.mjs';

const projectId = 'demo-pcinventory';
const collectorId = 'test-collector';
const adminId = 'test-admin';
const disabledCollectorId = 'test-disabled-collector';
const disabledAdminId = 'test-disabled-admin';
const userId = 'test-user';
const deviceId = pendingFixture.deviceId;
const settingsPath = 'settings/inventory';
const reportPath = reportId => 'inventoryReports/' + reportId;
const cardPath = id => 'computers/' + id;
const optionalAssignmentKeys = ['inventoryNumber', 'employeeName', 'department', 'comment'];
const firstId = '6c021ce0-b1a0-4680-8780-f210f00f0003';
const secondId = '6c021ce0-b1a0-4680-8780-f210f00f0004';
let env;
let collector;
let admin;

function emulatorPort(variable) {
  const value = process.env[variable];
  const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(value ?? '');
  assert.ok(match && Number(match[1]) > 0 && Number(match[1]) <= 65535,
    variable + ' must address a local Firebase emulator');
  return Number(match[1]);
}

before(async () => {
  setLogLevel('silent');
  const port = emulatorPort('FIRESTORE_EMULATOR_HOST');
  emulatorPort('FIREBASE_AUTH_EMULATOR_HOST');
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port,
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
  collector = env.authenticatedContext(collectorId).firestore();
  admin = env.authenticatedContext(adminId).firestore();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed({
    ['users/' + collectorId]: { role: 'COLLECTOR', enabled: true },
    ['users/' + adminId]: { role: 'ADMIN', enabled: true },
    ['users/' + disabledCollectorId]: { role: 'COLLECTOR', enabled: false },
    ['users/' + disabledAdminId]: { role: 'ADMIN', enabled: false },
    ['users/' + userId]: { role: 'USER', enabled: true },
    [settingsPath]: { acceptingReports: true },
  });
});

after(async () => {
  await env?.cleanup();
});

async function seed(documents) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [path, data] of Object.entries(documents)) {
      batch.set(doc(db, path), data);
    }
    await batch.commit();
  });
}

test('verified sign-up requests no access until an administrator approves', async () => {
  const uid = 'new-request';
  const email = 'new@example.test';
  const profile = { role: 'USER', enabled: false, pending: true, email };
  const applicant = env.authenticatedContext(uid, { email, email_verified: true }).firestore();
  const unverified = env.authenticatedContext(uid, { email, email_verified: false }).firestore();
  const user = db => doc(db, 'users', uid);
  await assertFails(setDoc(user(unverified), profile));
  await assertFails(setDoc(user(applicant), { ...profile, email: 'forged@example.test' }));
  await assertFails(setDoc(user(applicant), { ...profile, role: 'ADMIN' }));
  await assertFails(setDoc(user(applicant), { ...profile, enabled: true }));
  await assertSucceeds(setDoc(user(applicant), profile));
  await assertFails(getDocsFromServer(collection(applicant, 'computers')));
  await assertFails(updateDoc(user(applicant), { enabled: true }));
  await assertFails(getDocsFromServer(collection(admin, 'users')));
  await assertSucceeds(getDocsFromServer(query(collection(admin, 'users'), where('role', 'in', ['ADMIN', 'USER']))));
  await assertFails(getDocFromServer(doc(admin, 'users', collectorId)));
  await assertFails(updateDoc(doc(admin, 'users', collectorId), { role: 'USER' }));
  const batch = writeBatch(admin);
  batch.set(doc(admin, 'settings/access'), { adminUid: adminId });
  batch.update(user(admin), { pending: false, enabled: true, displayName: 'New user' });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDocsFromServer(collection(applicant, 'computers')));
  await assertFails(updateDoc(user(admin), { email: 'forged@example.test' }));
  await assertFails(deleteDoc(user(admin)));
  await assertSucceeds(updateDoc(user(admin), { enabled: false }));
  await assertFails(getDocsFromServer(collection(applicant, 'computers')));
});

test('concurrent demotion and deactivation leave an active administrator', async () => {
  const otherId = 'other-admin';
  await seed({ ['users/' + otherId]: { role: 'ADMIN', enabled: true },
    ['settings/access']: { adminUid: adminId } });
  const other = env.authenticatedContext(otherId).firestore();
  await assertFails(updateDoc(doc(admin, 'users', adminId), { role: 'USER' }));
  await assertFails(setDoc(doc(admin, 'settings/access'), { adminUid: userId }));
  await assertFails(deleteDoc(doc(admin, 'settings/access')));
  const demote = () => {
    const batch = writeBatch(admin);
    batch.set(doc(admin, 'settings/access'), { adminUid: otherId });
    batch.update(doc(admin, 'users', adminId), { role: 'USER' });
    return batch.commit();
  };
  const outcomes = await Promise.allSettled([
    demote(), updateDoc(doc(other, 'users', otherId), { enabled: false }),
  ]);
  const committed = outcomes.filter(result => result.status === 'fulfilled').length;
  assert.ok(committed <= 1);
  // The emulator can reject both cross-document writes during lock contention.
  if (committed === 0) await assertSucceeds(demote());
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const anchor = (await getDocFromServer(doc(db, 'settings/access'))).get('adminUid');
    const profile = await getDocFromServer(doc(db, 'users', anchor));
    assert.deepEqual(profile.data(), { role: 'ADMIN', enabled: true });
  });
});

test('collector can read only the confirmed location directory', async () => {
  const location = { building: 'Корпус Б', floor: '2', room: '010' };
  const path = 'locations/' + await locationId(location);
  const reader = env.authenticatedContext(userId).firestore();
  const disabled = env.authenticatedContext(disabledCollectorId).firestore();
  const anonymous = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(collector, path), location));
  await assertFails(setDoc(doc(admin, path), { ...location, employeeName: 'Сотрудник' }));
  await assertSucceeds(setDoc(doc(admin, path), location));
  assert.deepEqual((await assertSucceeds(getDocFromServer(doc(collector, path)))).data(), location);
  await assertSucceeds(getDocsFromServer(collection(collector, 'locations')));
  await assertSucceeds(getDocsFromServer(collection(reader, 'locations')));
  await assertFails(getDocsFromServer(collection(anonymous, 'locations')));
  await assertFails(getDocsFromServer(collection(disabled, 'locations')));
  await assertFails(getDocsFromServer(collection(collector, 'computers')));
  await assertFails(getDocsFromServer(collection(collector, 'inventoryReports')));
  await assertFails(updateDoc(doc(admin, path), { room: '011' }));
  await assertFails(deleteDoc(doc(admin, path)));
  const previousName = 'locationRenames/' + await locationId(location);
  await seed({ [previousName]: location });
  await assertSucceeds(getDocFromServer(doc(admin, previousName)));
  await assertFails(getDocFromServer(doc(collector, previousName)));
  await assertFails(deleteDoc(doc(admin, previousName)));
});

function submission(reportId = firstId, uid = collectorId) {
  return { ...structuredClone(pendingFixture), reportId, submittedAt: serverTimestamp(), submittedBy: uid };
}

async function submit(report = submission(), db = collector) {
  await setDoc(doc(db, reportPath(report.reportId)), report);
  return (await getDocFromServer(doc(admin, reportPath(report.reportId)))).data();
}

function review(status = 'ACCEPTED') {
  return { status, reviewedBy: adminId, reviewedAt: serverTimestamp() };
}

function acceptedCard(report, previous) {
  const effective = report.correction ?? report;
  const assignment = Object.fromEntries(optionalAssignmentKeys.map(key => [key, previous?.[key] ?? '']));
  Object.assign(assignment, effective.assignment);
  const assignmentChanged = !previous || Object.keys(assignment).some(key => assignment[key] !== previous[key]);
  return {
    ...effective.hardware,
    ...assignment,
    deviceId: report.deviceId,
    status: previous?.status ?? 'ACTIVE',
    lastReportId: report.reportId,
    lastInventoryAt: report.submittedAt,
    assignmentUpdatedAt: assignmentChanged ? serverTimestamp() : previous.assignmentUpdatedAt,
    assignmentUpdatedBy: assignmentChanged ? adminId : previous.assignmentUpdatedBy,
  };
}

async function accept(reportId) {
  return runTransaction(admin, async transaction => {
    const reportRef = doc(admin, reportPath(reportId));
    const report = (await transaction.get(reportRef)).data();
    if (report?.status !== 'PENDING') {
      throw new Error('Report is not pending');
    }
    const cardRef = doc(admin, cardPath(report.deviceId));
    const previous = (await transaction.get(cardRef)).data();
    transaction.set(cardRef, acceptedCard(report, previous));
    transaction.update(reportRef, review());
  });
}

function commitReview(report, card, status = 'ACCEPTED', reviewFields = review(status)) {
  const batch = writeBatch(admin);
  batch.set(doc(admin, cardPath(report.deviceId)), card);
  batch.update(doc(admin, reportPath(report.reportId)), reviewFields);
  return batch.commit();
}

test('only the enabled collector can create a pending report', async () => {
  for (const [uid, db] of [
    [collectorId, env.unauthenticatedContext().firestore()],
    [adminId, admin],
    [disabledCollectorId, env.authenticatedContext(disabledCollectorId).firestore()],
    ['unassigned-user', env.authenticatedContext('unassigned-user', { role: 'COLLECTOR' }).firestore()],
  ]) {
    await assertFails(setDoc(doc(db, reportPath(firstId)), submission(firstId, uid)));
  }
  const pending = await assertSucceeds(submit());
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.assignment.building, pendingFixture.assignment.building);
  assert.ok(pending.submittedAt instanceof Timestamp);
  assert.equal((await getDocFromServer(doc(admin, cardPath(deviceId)))).exists(), false);
  await assertFails(setDoc(doc(collector, reportPath(firstId)), submission()));
});

test('collector cannot read, update or delete reports or write a computer', async () => {
  await submit();
  const report = doc(collector, reportPath(firstId));
  await assertFails(getDocFromServer(report));
  await assertFails(getDocsFromServer(collection(collector, 'inventoryReports')));
  await assertFails(updateDoc(report, { status: 'REJECTED' }));
  await assertFails(deleteDoc(report));
  await assertFails(setDoc(doc(collector, cardPath(deviceId)), { hostname: 'TEST-PC' }));
  await assertFails(getDocFromServer(doc(collector, cardPath(deviceId))));
  await assertFails(getDocsFromServer(collection(collector, 'computers')));
  await assertFails(getDocFromServer(doc(collector, settingsPath)));
  await assertFails(updateDoc(doc(collector, settingsPath), { acceptingReports: false }));
});

test('a fully populated report fits the rules budget and can be accepted', async () => {
  const pending = submission();
  Object.assign(pending.assignment, {
    employeeName: 'Test User',
    department: 'Test Department',
    comment: 'Synthetic report',
  });
  Object.assign(pending.hardware, {
    motherboardSerial: 'TEST-BOARD-SERIAL',
    computerManufacturer: 'Test Manufacturer',
    computerModel: 'Test Tower',
  });
  await assertSucceeds(submit(pending));
  await assertSucceeds(accept(firstId));
  const card = (await getDocFromServer(doc(admin, cardPath(deviceId)))).data();
  assert.equal(card.employeeName, pending.assignment.employeeName);
  assert.equal(card.computerModel, pending.hardware.computerModel);

  const dhcpReport = { ...pending, reportId: secondId, deviceId: 'local-' + secondId };
  dhcpReport.hardware = {
    ...pending.hardware,
    identitySource: 'LOCAL',
    networkMode: 'DHCP',
    staticIpv4: [],
    networks: [{ name: 'Ethernet', mode: 'DHCP', staticIpv4: [] }],
  };
  await assertSucceeds(submit(dhcpReport));
  await assertSucceeds(accept(secondId));
  assert.equal((await getDocFromServer(doc(admin, cardPath(dhcpReport.deviceId)))).data().networkMode, 'DHCP');
});

test('only an enabled administrator can list reports or read computers', async () => {
  await submit();
  await accept(firstId);
  const pendingQuery = query(collection(admin, 'inventoryReports'), where('status', '==', 'ACCEPTED'));
  assert.equal((await assertSucceeds(getDocsFromServer(pendingQuery))).size, 1);
  assert.equal((await assertSucceeds(getDocsFromServer(collection(admin, 'computers')))).size, 1);
  for (const db of [
    env.unauthenticatedContext().firestore(),
    env.authenticatedContext(disabledAdminId).firestore(),
    env.authenticatedContext('unassigned-user', { role: 'ADMIN' }).firestore(),
  ]) {
    await assertFails(getDocFromServer(doc(db, reportPath(firstId))));
    await assertFails(getDocsFromServer(collection(db, 'inventoryReports')));
    await assertFails(getDocFromServer(doc(db, cardPath(deviceId))));
    await assertFails(updateDoc(doc(db, reportPath(firstId)), review('REJECTED')));
  }
});

test('users can read their own role and cannot change or list roles', async () => {
  assert.equal((await assertSucceeds(getDocFromServer(doc(collector, 'users/' + collectorId)))).data().role, 'COLLECTOR');
  await assertFails(getDocFromServer(doc(collector, 'users/' + adminId)));
  await assertFails(getDocFromServer(doc(admin, 'users/' + collectorId)));
  await assertFails(getDocsFromServer(collection(admin, 'users')));
  await assertFails(updateDoc(doc(collector, 'users/' + collectorId), { role: 'ADMIN' }));
  await assertFails(updateDoc(doc(admin, 'users/' + collectorId), { enabled: false }));
  await assertFails(setDoc(doc(admin, 'users/someone-else'), { role: 'ADMIN', enabled: true }));
});

test('admin can only toggle the known boolean setting', async () => {
  assert.equal((await assertSucceeds(getDocFromServer(doc(admin, settingsPath)))).data().acceptingReports, true);
  await assertFails(updateDoc(doc(admin, settingsPath), { acceptingReports: 'true' }));
  await assertFails(updateDoc(doc(admin, settingsPath), { anotherSetting: true }));
  await assertFails(setDoc(doc(admin, 'settings/other'), { acceptingReports: true }));
  await assertFails(deleteDoc(doc(admin, settingsPath)));
});

test('closing or removing intake blocks new submissions with the same collector session', async () => {
  await assertSucceeds(updateDoc(doc(admin, settingsPath), { acceptingReports: false }));
  await assertFails(setDoc(doc(collector, reportPath(firstId)), submission()));
  await env.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), settingsPath)));
  await assertFails(setDoc(doc(collector, reportPath(firstId)), submission()));
  await assertSucceeds(setDoc(doc(admin, settingsPath), { acceptingReports: true }));
  await assertSucceeds(submit());
});

test('rejects spoofed metadata, invalid locations and invalid hardware fields', async () => {
  const mutations = [
    ['spoofed ID', report => { report.reportId = secondId; }],
    ['spoofed collector', report => { report.submittedBy = adminId; }],
    ['client timestamp', report => { report.submittedAt = Timestamp.fromMillis(1); }],
    ['client review', report => { report.reviewedBy = adminId; }],
    ['client status', report => { report.status = 'ACCEPTED'; }],
    ['missing building', report => { delete report.assignment.building; }],
    ['blank building', report => { report.assignment.building = ' \t\u00a0'; }],
    ['invalid floor', report => { report.assignment.floor = ' '; }],
    ['numeric room', report => { report.assignment.room = 10; }],
    ['unknown assignment field', report => { report.assignment.status = 'ACTIVE'; }],
    ['unknown hardware field', report => { report.hardware.extra = true; }],
    ['numeric nullable string', report => { report.hardware.motherboardSerial = 12; }],
    ['missing nullable field', report => { delete report.hardware.motherboardSerial; }],
    ['unsupported schema', report => { report.hardware.schemaVersion = 2; }],
    ['identity mismatch', report => { report.hardware.identitySource = 'LOCAL'; }],
    ['invalid RAM total', report => { report.hardware.ramTotalGiB = 25; }],
    ['invalid slot counters', report => { report.hardware.ramSlotsFree = 1; }],
    ['too many GPUs', report => { report.hardware.gpus = Array(17).fill({ model: 'Test GPU' }); }],
  ];
  for (const [name, change] of mutations) {
    const invalid = submission();
    change(invalid);
    try {
      await assertFails(setDoc(doc(collector, reportPath(firstId)), invalid));
    } catch (error) {
      throw new Error(name, { cause: error });
    }
  }
  assert.equal((await getDocFromServer(doc(admin, reportPath(firstId)))).exists(), false);
});

test('atomic acceptance creates one card with the exact hardware, location and audit', async () => {
  const pending = await submit();
  await assertSucceeds(accept(firstId));
  const report = (await getDocFromServer(doc(admin, reportPath(firstId)))).data();
  const card = (await getDocFromServer(doc(admin, cardPath(deviceId)))).data();
  assert.deepEqual(report.hardware, pending.hardware);
  assert.deepEqual(report.assignment, pending.assignment);
  assert.equal(report.status, 'ACCEPTED');
  assert.equal(report.reviewedBy, adminId);
  assert.equal(card.status, 'ACTIVE');
  assert.equal(card.assignmentUpdatedBy, adminId);
  assert.ok(card.assignmentUpdatedAt.isEqual(report.reviewedAt));
  assert.ok(card.lastInventoryAt.isEqual(report.submittedAt));
  assert.equal(card.lastReportId, firstId);
  assert.equal(card.inventoryNumber, '000123');
  assert.equal(card.room, '010');
  for (const [key, value] of Object.entries(report.hardware)) {
    assert.deepEqual(card[key], value);
  }
  await assertFails(deleteDoc(doc(admin, cardPath(deviceId))));
  await assertFails(deleteDoc(doc(admin, reportPath(firstId))));
});

test('both acceptance writes and their document links are mandatory', async () => {
  const pending = await submit();
  const card = acceptedCard(pending);
  await assertFails(updateDoc(doc(admin, reportPath(firstId)), review()));
  await assertFails(setDoc(doc(admin, cardPath(deviceId)), card));
  await assertFails(commitReview(pending, { ...card, lastReportId: secondId }));
  await assertFails(commitReview(pending, { ...card, lastInventoryAt: Timestamp.fromMillis(1) }));
  await assertFails(commitReview(pending, { ...card, hostname: 'MODIFIED' }));
  await assertFails(commitReview(pending, { ...card, building: 'Другой корпус' }));
  await assertFails(commitReview(pending, { ...card, status: 'RETIRED' }));
  await assertFails(commitReview(pending, card, 'ACCEPTED', { ...review(), reviewedBy: collectorId }));
  await assertFails(commitReview(pending, card, 'ACCEPTED', { ...review(), submittedBy: adminId }));
  await assertFails(commitReview(pending, card, 'ACCEPTED', { ...review(), reviewedAt: Timestamp.fromMillis(1) }));
  assert.equal((await getDocFromServer(doc(admin, reportPath(firstId)))).data().status, 'PENDING');
  assert.equal((await getDocFromServer(doc(admin, cardPath(deviceId)))).exists(), false);
});

test('two simultaneous review transactions accept the report only once', async () => {
  await submit();
  const results = await Promise.allSettled([accept(firstId), accept(firstId)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await getDocFromServer(doc(admin, reportPath(firstId)))).data().status, 'ACCEPTED');
  assert.equal((await getDocsFromServer(collection(admin, 'computers'))).size, 1);
});

test('rejection preserves the existing card and cannot later be accepted', async () => {
  await submit();
  await accept(firstId);
  const cardRef = doc(admin, cardPath(deviceId));
  const oldCard = (await getDocFromServer(cardRef)).data();
  const pending = await submit(submission(secondId));
  await assertFails(commitReview(pending, { ...oldCard, room: '020', assignmentUpdatedAt: serverTimestamp() }, 'REJECTED'));
  await assertSucceeds(updateDoc(doc(admin, reportPath(secondId)), review('REJECTED')));
  assert.deepEqual((await getDocFromServer(cardRef)).data(), oldCard);
  const rejected = (await getDocFromServer(doc(admin, reportPath(secondId)))).data();
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.reviewedBy, adminId);
  await assertFails(commitReview(pending, acceptedCard(pending, oldCard)));
});

test('the admin may edit card data while report links and identity stay immutable', async () => {
  await submit();
  await accept(firstId);
  const cardRef = doc(admin, cardPath(deviceId));
  const audit = () => ({ assignmentUpdatedAt: serverTimestamp(), assignmentUpdatedBy: adminId });
  await assertSucceeds(updateDoc(cardRef, { building: 'Корпус В', room: '020', status: 'RETIRED', ...audit() }));
  await assertFails(updateDoc(cardRef, { building: deleteField(), ...audit() }));
  await assertFails(updateDoc(cardRef, { building: ' ', ...audit() }));
  await assertSucceeds(updateDoc(cardRef, { cpuModel: 'Verified model', ...audit() }));
  await assertSucceeds(updateDoc(cardRef, { cpuModel: 'Verified again', room: '022', ...audit() }));
  await assertFails(updateDoc(cardRef, { cpuCores: 0, ...audit() }));
  await assertFails(updateDoc(cardRef, { cpuModel: deleteField(), ...audit() }));
  await assertFails(updateDoc(cardRef, { identitySource: 'LOCAL', ...audit() }));
  await assertFails(updateDoc(cardRef, { lastReportId: secondId, ...audit() }));
  await assertFails(updateDoc(cardRef, { status: deleteField(), ...audit() }));
  await assertFails(updateDoc(cardRef, { room: '021', ...audit(), assignmentUpdatedBy: collectorId }));
});

test('enabled users can read the registry and cannot access the intake or write records', async () => {
  const user = env.authenticatedContext(userId).firestore();
  await submit();
  const pending = await submit(submission(secondId));
  await accept(firstId);
  assert.equal((await assertSucceeds(getDocsFromServer(collection(user, 'computers')))).size, 1);
  await assertSucceeds(getDocFromServer(doc(user, cardPath(deviceId))));
  await assertSucceeds(getDocFromServer(doc(user, 'users/' + userId)));
  await assertFails(getDocsFromServer(collection(user, 'inventoryReports')));
  await assertFails(getDocFromServer(doc(user, reportPath(secondId))));
  await assertFails(getDocFromServer(doc(user, settingsPath)));
  await assertFails(setDoc(doc(user, reportPath('6c021ce0-b1a0-4680-8780-f210f00f0009')),
    submission('6c021ce0-b1a0-4680-8780-f210f00f0009', userId)));
  await assertFails(updateDoc(doc(user, settingsPath), { acceptingReports: false }));
  await assertFails(updateDoc(doc(user, reportPath(secondId)), review('REJECTED')));
  await assertFails(setDoc(doc(user, cardPath(manualCard(pending).deviceId)), manualCard(pending)));
  await assertFails(updateDoc(doc(user, cardPath(deviceId)), { status: 'RETIRED' }));
  await seed({ ['users/' + userId]: { role: 'USER', enabled: false } });
  await assertFails(getDocsFromServer(collection(user, 'computers')));
});

const manualId = 'manual-6c021ce0-b1a0-4680-8780-f210f00f0008';
function manualCard(report) {
  return {
    ...acceptedCard(report),
    deviceId: manualId,
    identitySource: 'MANUAL',
    agentVersion: 'manual',
    lastReportId: null,
    lastInventoryAt: null,
  };
}

test('admin creates, archives, restores and finally purges a card', async () => {
  const pending = await submit();
  const ref = doc(admin, cardPath(manualId));
  const card = manualCard(pending);
  await assertFails(setDoc(ref, { ...card, lastReportId: firstId }));
  await assertFails(setDoc(ref, { ...card, status: 'RETIRED' }));
  await assertFails(setDoc(ref, { ...card, building: '' }));
  await assertFails(setDoc(ref, { ...card, employeeName: 'Synthetic User', unexpected: true }));
  await assertSucceeds(setDoc(ref, { ...card, employeeName: 'Synthetic User', department: 'Test', comment: 'Test' }));
  assert.equal((await getDocFromServer(ref)).data().lastInventoryAt, null);
  await assertFails(deleteDoc(ref));
  const status = value => ({ status: value, assignmentUpdatedAt: serverTimestamp(), assignmentUpdatedBy: adminId });
  const skipArchive = writeBatch(admin);
  skipArchive.update(ref, status('RETIRED'));
  skipArchive.delete(ref);
  await assertFails(skipArchive.commit());
  await assertSucceeds(updateDoc(ref, status('RETIRED')));
  await assertFails(deleteDoc(doc(env.authenticatedContext(userId).firestore(), cardPath(manualId))));
  await assertSucceeds(updateDoc(ref, status('ACTIVE')));
  await assertFails(deleteDoc(ref));
  await assertSucceeds(updateDoc(ref, status('RETIRED')));
  await assertSucceeds(deleteDoc(ref));
  assert.equal((await getDocFromServer(ref)).exists(), false);
  await accept(firstId);
  const accepted = doc(admin, cardPath(deviceId));
  await assertSucceeds(updateDoc(accepted, status('RETIRED')));
  await assertSucceeds(deleteDoc(accepted));
  assert.equal((await getDocFromServer(doc(admin, reportPath(firstId)))).data().status, 'ACCEPTED');
});

test('only admin can save pending corrections and acceptance must use the saved version', async () => {
  const original = await submit();
  const ref = doc(admin, reportPath(firstId));
  const correction = {
    hardware: { ...original.hardware, cpuModel: 'Verified CPU', computerModel: 'Verified computer',
      computerManufacturer: 'Verified manufacturer', motherboardSerial: 'VERIFIED' },
    assignment: { ...original.assignment, building: 'Verified building', floor: '03', room: '011',
      employeeName: 'Test Staff', department: 'Test Department', comment: 'Verified location' },
    updatedAt: serverTimestamp(),
    updatedBy: adminId,
  };
  await assertFails(setDoc(doc(collector, reportPath(secondId)), { ...submission(secondId), correction }));
  await assertFails(updateDoc(doc(collector, reportPath(firstId)), { correction }));
  await assertFails(updateDoc(doc(env.authenticatedContext(userId).firestore(), reportPath(firstId)), { correction }));
  await assertFails(updateDoc(ref, { correction: { ...correction, updatedBy: collectorId } }));
  await assertFails(updateDoc(ref, { correction: { ...correction, hardware: { ...correction.hardware,
    identitySource: 'LOCAL' } } }));
  await assertFails(updateDoc(ref, { correction: { ...correction, hardware: { ...correction.hardware, cpuCores: 0 } } }));
  await assertFails(updateDoc(ref, { correction, 'hardware.cpuModel': 'Direct edit' }));
  await assertSucceeds(updateDoc(ref, { correction }));
  const corrected = (await getDocFromServer(ref)).data();
  assert.deepEqual(corrected.hardware, original.hardware);
  assert.deepEqual(corrected.assignment, original.assignment);
  assert.equal(corrected.correction.updatedBy, adminId);
  await assertFails(commitReview(original, acceptedCard(original)));
  await assertFails(commitReview(corrected, acceptedCard(corrected), 'ACCEPTED', { ...review(), correction }));
  await assertFails(commitReview(corrected, { ...acceptedCard(corrected), floor: original.assignment.floor }));
  await assertSucceeds(accept(firstId));
  const card = (await getDocFromServer(doc(admin, cardPath(deviceId)))).data();
  assert.equal(card.cpuModel, 'Verified CPU');
  assert.equal(card.building, 'Verified building');
  assert.equal(card.floor, '03');
  assert.equal(card.room, '011');
  await assertFails(updateDoc(ref, { correction }));
});

test('new acceptance preserves omitted fields and the archived status, and rejects replay', async () => {
  await submit();
  await accept(firstId);
  const cardRef = doc(admin, cardPath(deviceId));
  await assertSucceeds(updateDoc(cardRef, { status: 'RETIRED', comment: 'Previous note',
    assignmentUpdatedAt: serverTimestamp(), assignmentUpdatedBy: adminId }));
  const previous = (await getDocFromServer(cardRef)).data();
  const newer = submission(secondId);
  newer.assignment = { building: 'Корпус В', floor: '2', room: '015' };
  newer.hardware.hostname = 'UPDATED-TEST-PC';
  const pending = await submit(newer);
  await assertFails(commitReview(pending, { ...acceptedCard(pending, previous), inventoryNumber: '' }));
  await assertFails(commitReview(pending, { ...acceptedCard(pending, previous), status: 'ACTIVE' }));
  await assertSucceeds(accept(secondId));
  const updated = (await getDocFromServer(cardRef)).data();
  assert.equal(updated.hostname, 'UPDATED-TEST-PC');
  assert.equal(updated.status, 'RETIRED');
  assert.equal(updated.room, '015');
  assert.equal(updated.comment, 'Previous note');
  assert.equal(updated.inventoryNumber, '000123');
  await assertFails(commitReview(pending, acceptedCard(pending, updated)));
  await assertFails(updateDoc(doc(admin, reportPath(secondId)), review('REJECTED')));
});

test('stale reports cannot overwrite a newer card; equal times use report ID order', async () => {
  const older = { ...submission(firstId), submittedAt: Timestamp.fromMillis(1000) };
  const newer = { ...submission(secondId), submittedAt: Timestamp.fromMillis(2000) };
  const tieId = '6c021ce0-b1a0-4680-8780-f210f00f0005';
  const tie = { ...submission(tieId), submittedAt: newer.submittedAt };
  await seed({ [reportPath(firstId)]: older, [reportPath(secondId)]: newer, [reportPath(tieId)]: tie });
  await assertSucceeds(accept(secondId));
  const previous = (await getDocFromServer(doc(admin, cardPath(deviceId)))).data();
  await assertFails(accept(firstId));
  await assertSucceeds(accept(tieId));
  const updated = (await getDocFromServer(doc(admin, cardPath(deviceId)))).data();
  assert.equal(updated.lastReportId, tieId);
  assert.ok(updated.assignmentUpdatedAt.isEqual(previous.assignmentUpdatedAt));
  assert.equal((await getDocFromServer(doc(admin, reportPath(firstId)))).data().status, 'PENDING');
});

test('a real Auth emulator session loses Firestore write access when its role is disabled', async () => {
  const app = initializeApp({ projectId, apiKey: 'demo-pcinventory-local-only' }, 'auth-session-test');
  try {
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:' + emulatorPort('FIREBASE_AUTH_EMULATOR_HOST'),
      { disableWarnings: true });
    const email = randomUUID() + '@example.invalid';
    const password = randomUUID();
    const created = await createUserWithEmailAndPassword(auth, email, password);
    const uid = created.user.uid;
    await signOut(auth);
    await signInWithEmailAndPassword(auth, email, password);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', emulatorPort('FIRESTORE_EMULATOR_HOST'));
    const path = 'users/' + uid;
    await seed({ [path]: { role: 'COLLECTOR', enabled: true } });
    await assertSucceeds(submit(submission(firstId, uid), db));
    await seed({ [path]: { role: 'COLLECTOR', enabled: false } });
    await assertFails(setDoc(doc(db, reportPath(secondId)), submission(secondId, uid)));
  } finally {
    await deleteApp(app);
  }
});
