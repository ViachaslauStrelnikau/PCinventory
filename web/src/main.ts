import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

import { firebaseOptions, loadFirebaseOptions } from './app/core/firebase-environment';

loadFirebaseOptions().then(options => bootstrapApplication(App, {
  ...appConfig, providers: [...appConfig.providers, { provide: firebaseOptions, useValue: options }],
}))
  .catch(error => {
    const status = document.getElementById('app-startup-status');
    if (status) {
      status.classList.remove('is-spinning');
      status.setAttribute('role', 'alert');
      status.textContent = 'Не удалось загрузить приложение. Обновите страницу.';
    }
    console.error(error);
  });
