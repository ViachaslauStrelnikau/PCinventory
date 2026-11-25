import { Injectable } from '@angular/core';
import { getApp } from 'firebase/app';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

@Injectable({ providedIn: 'root' })
export class LocalFunctions {
  private readonly endpoint = getFunctions(getApp());

  constructor() { connectFunctionsEmulator(this.endpoint, '127.0.0.1', 5001); }

  async invoke<Request, Response>(name: string, command: Request): Promise<Response> {
    return (await httpsCallable<Request, Response>(this.endpoint, name)(command)).data;
  }
}
