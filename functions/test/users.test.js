import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-pcinventory';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(authHost ?? '', /^127\.0\.0\.1:\d+$/);
assert.match(firestoreHost ?? '', /^127\.0\.0\.1:\d+$/);
const functionsPort = process.env.PCINVENTORY_FUNCTIONS_PORT ?? '5001';
assert.match(functionsPort, /^\d+$/);
const endpoint = 'http://127.0.0.1:' + functionsPort + '/' + projectId + '/us-central1/manageWebUsers';

initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();
const users = db.collection('users');
const domain = randomUUID() + '.example.test';
const emailFor = name => name + '@' + domain;
const password = 'Demo1-' + randomUUID();

async function request(command, token) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ data: command }),
  });
  const result = await response.json();
  return { status: response.status, result: result.result, error: result.error };
}

async function invoke(command, token) {
  const response = await request(command, token);
  assert.equal(response.status, 200, JSON.stringify(response.error));
  return response.result;
}

async function signIn(email) {
  const response = await fetch('http://' + authHost + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).idToken;
}

async function seed(name, role, enabled = true) {
  const email = emailFor(name);
  const { uid } = await auth.createUser({ email, password });
  await users.doc(uid).create({ role, enabled });
  return { uid, email, token: await signIn(email) };
}

test('server enforces protected web account management and the last active administrator', { timeout: 60000 }, async () => {
  const [admin, reader, disabled, collector] = await Promise.all([
    seed('admin', 'ADMIN'), seed('reader', 'USER'), seed('disabled', 'ADMIN', false), seed('collector', 'COLLECTOR'),
  ]);
  await users.doc('orphan-' + randomUUID()).create({ role: 'ADMIN', enabled: true });
  const noPassword = await auth.createUser({ email: emailFor('no-password') });
  await users.doc(noPassword.uid).create({ role: 'ADMIN', enabled: true });

  assert.equal((await request({ action: 'list' })).status, 401);
  for (const account of [reader, disabled, collector]) {
    assert.equal((await request({ action: 'list' }, account.token)).status, 403);
    assert.equal((await request({ action: 'setEnabled', uid: admin.uid, enabled: false }, account.token)).status, 403);
  }

  const directory = await invoke({ action: 'list' }, admin.token);
  assert.equal(directory.find(user => user.uid === admin.uid)?.email, admin.email);
  assert.equal(directory.find(user => user.uid === admin.uid)?.authAvailable, true);
  assert.equal(directory.find(user => user.uid === noPassword.uid)?.authAvailable, false);
  assert(!directory.some(user => user.uid === collector.uid));
  assert.equal((await request({ action: 'update', uid: collector.uid, displayName: '', role: 'ADMIN' }, admin.token)).status, 404);
  assert.equal((await request({ action: 'delete', uid: reader.uid }, admin.token)).status, 400);

  for (const command of [
    { action: 'setEnabled', uid: admin.uid, enabled: false },
    { action: 'update', uid: admin.uid, displayName: '', role: 'USER' },
  ]) {
    const denied = await request(command, admin.token);
    assert.equal(denied.status, 400);
    assert.equal(denied.error.status, 'FAILED_PRECONDITION');
    assert.equal(denied.error.message, 'last-admin');
  }

  const create = { action: 'create', requestId: randomUUID(), email: emailFor('new'),
    password, displayName: 'Created user', role: 'USER' };
  for (const weakPassword of ['Aa1shor', 'lowercase123', 'UPPERCASE123', 'WithoutDigits', 'Aa1' + 'b'.repeat(126)]) {
    const denied = await request({ ...create, password: weakPassword }, admin.token);
    assert.equal(denied.status, 400);
    assert.equal(denied.error.message, 'invalid-password-policy');
  }
  const { uid } = await invoke(create, admin.token);
  assert.equal((await invoke(create, admin.token)).uid, uid);
  assert.equal((await request({ ...create, requestId: randomUUID() }, admin.token)).error.message, 'email-in-use');
  const createdToken = await signIn(create.email);
  assert.equal((await request({ action: 'list' }, createdToken)).status, 403);

  await invoke({ action: 'update', uid, displayName: 'Renamed user', role: 'USER' }, admin.token);
  const newEmail = emailFor('changed');
  await invoke({ action: 'changeEmail', uid, email: newEmail }, admin.token);
  const changedToken = await signIn(newEmail);
  const entry = (await invoke({ action: 'list' }, admin.token)).find(user => user.uid === uid);
  assert.equal(entry.email, newEmail);
  assert.equal(entry.displayName, 'Renamed user');

  const adminToken = admin.token;
  const registry = 'http://' + firestoreHost + '/v1/projects/' + projectId + '/databases/(default)/documents/computers';
  const readRegistry = token => fetch(registry, { headers: { Authorization: 'Bearer ' + token } });
  assert.equal((await readRegistry(changedToken)).status, 200);
  await invoke({ action: 'setEnabled', uid, enabled: false }, adminToken);
  assert.equal((await readRegistry(changedToken)).status, 403);
  assert.equal((await auth.getUser(uid)).email, newEmail);
  assert.equal((await users.doc(uid).get()).get('enabled'), false);
  await invoke({ action: 'setEnabled', uid, enabled: true }, adminToken);
  assert.equal((await readRegistry(changedToken)).status, 200);

  await invoke({ action: 'update', uid, displayName: 'Renamed user', role: 'ADMIN' }, adminToken);
  assert.equal((await request({ action: 'list' }, changedToken)).status, 200);
  const concurrent = await Promise.all([
    request({ action: 'setEnabled', uid: admin.uid, enabled: false }, adminToken),
    request({ action: 'update', uid, displayName: 'Renamed user', role: 'USER' }, changedToken),
  ]);
  assert.equal(concurrent.filter(result => result.status === 200).length, 1, JSON.stringify(concurrent));
  assert.equal(concurrent.find(result => result.status !== 200).error.message, 'last-admin');
  const candidates = await Promise.all([admin.uid, uid].map(id => users.doc(id).get()));
  assert.equal(candidates.filter(doc => doc.get('enabled') && doc.get('role') === 'ADMIN').length, 1);
});
