import { access, writeFile } from 'node:fs/promises';

const { REQUESTED_FIREBASE_PROJECT_ID, FIREBASE_PROJECT_ID, FIREBASE_WEB_APP_ID, FIREBASE_WEB_API_KEY,
  FIREBASE_RESTORE_OAUTH_CLIENT_ID } = process.env;
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(FIREBASE_PROJECT_ID ?? '')) {
  throw new Error('FIREBASE_PROJECT_ID must contain a valid Firebase project ID.');
}
if (REQUESTED_FIREBASE_PROJECT_ID !== FIREBASE_PROJECT_ID) {
  throw new Error('Requested project_id must match FIREBASE_PROJECT_ID in the firebase environment.');
}
if (!/^1:[0-9]+:web:[a-f0-9]+$/i.test(FIREBASE_WEB_APP_ID ?? '')) {
  throw new Error('FIREBASE_WEB_APP_ID must identify a registered Firebase web app.');
}
if (!/^AIza[A-Za-z0-9_-]{35}$/.test(FIREBASE_WEB_API_KEY ?? '')) {
  throw new Error('FIREBASE_WEB_API_KEY must contain the Firebase web API key.');
}

if (FIREBASE_RESTORE_OAUTH_CLIENT_ID && !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(FIREBASE_RESTORE_OAUTH_CLIENT_ID)) {
  throw new Error('FIREBASE_RESTORE_OAUTH_CLIENT_ID must be a Google web OAuth client ID.');
}

if (!process.argv.includes('--check')) {
  const output = new URL('../dist/pcinventory/browser/', import.meta.url);
  await access(new URL('index.html', output));
  await writeFile(new URL('firebase-web-config.json', output), JSON.stringify({
    apiKey: FIREBASE_WEB_API_KEY,
    appId: FIREBASE_WEB_APP_ID,
    projectId: FIREBASE_PROJECT_ID,
    authDomain: FIREBASE_PROJECT_ID + '.firebaseapp.com',
    restoreOAuthClientId: FIREBASE_RESTORE_OAUTH_CLIENT_ID || undefined,
  }, null, 2) + '\n');
}
