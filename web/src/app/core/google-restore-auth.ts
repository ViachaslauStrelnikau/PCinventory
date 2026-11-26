const firestoreScope = 'https://www.googleapis.com/auth/datastore';
const identityScriptUrl = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}

export interface RestoreAuthorization {
  token: string;
  expiresAt: number;
}

export interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: () => void;
  }): { requestAccessToken(options: { prompt: 'select_account' }): void };
  hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
}

let pendingLibrary: Promise<GoogleOAuth> | undefined;

function currentLibrary(): GoogleOAuth | undefined {
  return (window as Window & { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts?.oauth2;
}

export function loadGoogleOAuth(): Promise<GoogleOAuth> {
  const available = currentLibrary();
  if (available) return Promise.resolve(available);
  if (pendingLibrary) return pendingLibrary;

  pendingLibrary = new Promise<GoogleOAuth>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = identityScriptUrl;
    script.async = true;
    const fail = () => {
      script.remove();
      reject(new Error('Не удалось загрузить вход Google. Повторите попытку.'));
    };
    script.addEventListener('error', fail, { once: true });
    script.addEventListener('load', () => {
      const library = currentLibrary();
      if (library) resolve(library);
      else fail();
    }, { once: true });
    document.head.append(script);
  }).catch(error => {
    pendingLibrary = undefined;
    throw error;
  });
  return pendingLibrary;
}

export function authorizeRestore(google: GoogleOAuth, clientId: string): Promise<RestoreAuthorization> {
  return new Promise((resolve, reject) => {
    const client = google.initTokenClient({
      client_id: clientId,
      scope: firestoreScope,
      include_granted_scopes: false,
      callback: response => {
        const expiresIn = Number(response.expires_in);
        if (response.error || !response.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0
            || !google.hasGrantedAllScopes(response, firestoreScope)) {
          reject(new Error('Google не выдал доступ к Firestore. Повторите вход.'));
          return;
        }
        resolve({ token: response.access_token, expiresAt: Date.now() + expiresIn * 1000 });
      },
      error_callback: () => reject(new Error('Окно входа Google закрыто или заблокировано браузером.')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}
