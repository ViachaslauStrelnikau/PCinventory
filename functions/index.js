import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();
const auth = getAuth();
const db = getFirestore();
const users = db.collection('users');
const roles = ['ADMIN', 'USER'];
const isAdmin = profile => profile?.role === 'ADMIN' && profile.enabled === true;
const canSignIn = account => Boolean(account?.email && !account.disabled
  && account.providerData.some(provider => provider.providerId === 'password'));

function requireAdmin(snapshot) {
  if (!isAdmin(snapshot.data())) throw new HttpsError('permission-denied', 'admin-required');
}

function requireWebUser(snapshot) {
  const profile = snapshot.data();
  if (!roles.includes(profile?.role)) throw new HttpsError('not-found', 'web-user-not-found');
  return profile;
}

function validateUid(uid) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || /[/\\]/.test(uid) || uid === '.' || uid === '..') {
    throw new HttpsError('invalid-argument', 'invalid-user');
  }
  return uid;
}

function validateProfile(data) {
  if (!roles.includes(data.role) || typeof data.displayName !== 'string' || data.displayName.trim().length > 120) {
    throw new HttpsError('invalid-argument', 'invalid-profile');
  }
  return { role: data.role, displayName: data.displayName.trim() };
}

function validateEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new HttpsError('invalid-argument', 'invalid-email');
  }
  return value.trim().toLowerCase();
}

async function accountsFor(ids) {
  const accounts = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { users: batch } = await auth.getUsers(ids.slice(offset, offset + 100).map(uid => ({ uid })));
    for (const user of batch) accounts.set(user.uid, user);
  }
  return accounts;
}

async function listUsers(actor) {
  requireAdmin(await actor.get());
  const snapshots = await users.where('role', 'in', roles).get();
  const accounts = await accountsFor(snapshots.docs.map(doc => doc.id));
  return snapshots.docs.map(doc => {
    const profile = doc.data();
    const account = accounts.get(doc.id);
    return {
      uid: doc.id,
      email: account?.email ?? '',
      displayName: profile.displayName ?? account?.displayName ?? '',
      role: profile.role,
      enabled: profile.enabled === true,
      authAvailable: canSignIn(account),
    };
  });
}

async function createUser(actor, data) {
  requireAdmin(await actor.get());
  const profile = validateProfile(data);
  const email = validateEmail(data.email);
  if (typeof data.requestId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(data.requestId)
    || typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128) {
    throw new HttpsError('invalid-argument', 'invalid-new-user');
  }
  const uid = 'web-' + data.requestId;
  try {
    await auth.createUser({ uid, email, password: data.password });
  } catch (error) {
    // The same request can finish provisioning after a retry without rewriting any existing account.
    if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error;
    const existing = (await accountsFor([uid])).get(uid);
    if (existing?.email !== email) throw error;
  }
  const target = users.doc(uid);
  await db.runTransaction(async transaction => {
    const [currentActor, currentTarget] = await transaction.getAll(actor, target);
    requireAdmin(currentActor);
    if (currentTarget.exists) {
      requireWebUser(currentTarget);
      return;
    }
    transaction.create(target, { ...profile, enabled: true, createdBy: actor.id, updatedBy: actor.id,
      updatedAt: FieldValue.serverTimestamp() });
  });
  return { uid };
}

async function changeProfile(actor, target, patch) {
  await db.runTransaction(async transaction => {
    const [currentActor, currentTarget] = actor.id === target.id
      ? await transaction.get(target).then(snapshot => [snapshot, snapshot])
      : await transaction.getAll(actor, target);
    requireAdmin(currentActor);
    const previous = requireWebUser(currentTarget);
    if (isAdmin(previous) && !isAdmin({ ...previous, ...patch })) {
      const admins = await transaction.get(users.where('role', '==', 'ADMIN'));
      const candidates = admins.docs.filter(doc => doc.id !== target.id && isAdmin(doc.data())).map(doc => doc.id);
      const accounts = await accountsFor(candidates);
      if (![...accounts.values()].some(canSignIn)) {
        throw new HttpsError('failed-precondition', 'last-admin');
      }
    }
    transaction.update(target, { ...patch, updatedBy: actor.id, updatedAt: FieldValue.serverTimestamp() });
  });
}

async function changeEmail(actor, target, value) {
  const email = validateEmail(value);
  const [currentActor, currentTarget] = actor.id === target.id
    ? await target.get().then(snapshot => [snapshot, snapshot])
    : await db.getAll(actor, target);
  requireAdmin(currentActor);
  requireWebUser(currentTarget);
  await auth.updateUser(target.id, { email, emailVerified: false });
  return null;
}

const errors = {
  'auth/email-already-exists': ['already-exists', 'email-in-use'],
  'auth/uid-already-exists': ['already-exists', 'user-in-use'],
  'auth/invalid-email': ['invalid-argument', 'invalid-email'],
  'auth/invalid-password': ['invalid-argument', 'invalid-new-user'],
  'auth/user-not-found': ['not-found', 'auth-user-not-found'],
};

export const manageWebUsers = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'sign-in-required');
  const actor = users.doc(request.auth.uid);
  const data = request.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'invalid-action');
  }
  try {
    switch (data.action) {
      case 'list':
        return await listUsers(actor);
      case 'create':
        return await createUser(actor, data);
      case 'update':
        await changeProfile(actor, users.doc(validateUid(data.uid)), validateProfile(data));
        return null;
      case 'setEnabled':
        if (typeof data.enabled !== 'boolean') throw new HttpsError('invalid-argument', 'invalid-status');
        await changeProfile(actor, users.doc(validateUid(data.uid)), { enabled: data.enabled });
        return null;
      case 'changeEmail':
        return await changeEmail(actor, users.doc(validateUid(data.uid)), data.email);
      default:
        throw new HttpsError('invalid-argument', 'invalid-action');
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error.code === 10) throw new HttpsError('aborted', 'concurrent-update');
    const mapped = Object.hasOwn(errors, error.code) ? errors[error.code] : null;
    if (mapped) throw new HttpsError(...mapped);
    // Auth and Firestore errors can contain account data in their messages.
    console.error('User management failed', { action: data.action, code: error.code ?? 'unknown' });
    throw new HttpsError('internal', 'user-operation-failed');
  }
});
