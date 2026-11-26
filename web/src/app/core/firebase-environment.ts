import { InjectionToken } from '@angular/core';
import type { FirebaseOptions } from 'firebase/app';

export type WebFirebaseOptions = FirebaseOptions & { restoreOAuthClientId?: string };

export const localFirestoreHost = '127.0.0.1';
export const localFirestorePort = 8080;

export const firebaseOptions = new InjectionToken<WebFirebaseOptions | null>('Firebase web configuration');

export const localFirebase = location.protocol === 'http:'
  && ['localhost', '127.0.0.1'].includes(location.hostname);

export async function loadFirebaseOptions(): Promise<WebFirebaseOptions | null> {
  if (localFirebase) return { projectId: 'demo-pcinventory', apiKey: 'demo-pcinventory-local-only' };
  if (location.protocol !== 'https:') return null;
  try {
    const response = await fetch(new URL('firebase-web-config.json', document.baseURI), { cache: 'no-store' });
    if (!response.ok) return null;
    const { apiKey, authDomain, projectId, appId, restoreOAuthClientId } = await response.json();
    if (![apiKey, authDomain, projectId, appId].every(value => typeof value === 'string' && value.trim())) return null;
    return { apiKey, authDomain, projectId, appId,
      restoreOAuthClientId: typeof restoreOAuthClientId === 'string' ? restoreOAuthClientId : undefined };
  } catch {
    return null;
  }
}
