import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

import { firebaseOptions, loadFirebaseOptions } from './app/core/firebase-environment';

loadFirebaseOptions().then(options => bootstrapApplication(App, {
  ...appConfig, providers: [...appConfig.providers, { provide: firebaseOptions, useValue: options }],
}))
  .catch((err) => console.error(err));
