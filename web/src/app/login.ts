import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { agentReleasesUrl, loadAgentRelease } from './core/agent-release';
import { InventoryData, messageFor } from './core/inventory-data';
import { meetsPasswordPolicy, passwordHint, passwordMaxLength } from './core/password-policy';

@Component({
  imports: [FormsModule],
  template: `
    <section class="login-card panel">
      <div class="brand">Computer Inventory</div>
      <h1>{{ registering() ? 'Регистрация' : 'Вход в реестр' }}</h1>
      @if (!data.configured) { <p class="alert error">Подключение к Firebase не настроено.</p> }
      @if (registering()) { <p class="muted">Подтвердите почту и войдите, чтобы отправить запрос администратору.</p> }
      @if (notice()) { <p role="status" class="notice success">{{ notice() }}</p> }
      <form class="form-stack" (ngSubmit)="login()">
        <label>Почта<input name="email" type="email" required autocomplete="username" [(ngModel)]="email"></label>
        <label>Пароль<input name="password" type="password" required
          [attr.autocomplete]="registering() ? 'new-password' : 'current-password'" [(ngModel)]="password"></label>
        @if (registering()) {
          <label>Повторите пароль<input name="confirmation" type="password" required autocomplete="new-password"
            [maxlength]="passwordMaxLength" [(ngModel)]="confirmation" aria-describedby="registration-password"></label>
          <p id="registration-password" class="muted">{{ passwordHint }}</p>
          @if (confirmation && password !== confirmation) { <p class="danger-text">Пароли не совпадают.</p> }
        }
        @if (error()) { <p role="alert" class="alert error">{{ error() }}</p> }
        <button type="submit" class="button primary"
          [disabled]="busy() || !data.configured || (registering() && !passwordPairValid)">
          {{ busy() ? 'Подождите…' : registering() ? 'Зарегистрироваться' : 'Войти' }}
        </button>
        <button type="button" class="button" [disabled]="busy() || !data.configured" (click)="toggleRegistration()">
          {{ registering() ? 'Вернуться ко входу' : 'Запросить доступ' }}
        </button>
      </form>
      @if (!registering()) {
        <div class="login-download">
          @if (agentRelease(); as release) {
            <a [href]="release.url">Скачать агент для Windows <span class="muted">({{ release.version }})</span></a>
          } @else {
            <a [href]="agentReleasesUrl">Сборки агента для Windows</a>
          }
        </div>
      }
    </section>`,
})
export class Login {
  readonly data = inject(InventoryData);
  private readonly router = inject(Router);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly registering = signal(false);
  readonly notice = signal('');
  readonly passwordHint = passwordHint;
  readonly passwordMaxLength = passwordMaxLength;
  readonly agentReleasesUrl = agentReleasesUrl;
  readonly agentRelease = signal<Awaited<ReturnType<typeof loadAgentRelease>>>(null);
  confirmation = '';

  constructor() {
    void loadAgentRelease().then(release => this.agentRelease.set(release));
  }

  get passwordPairValid(): boolean {
    return this.password === this.confirmation && meetsPasswordPolicy(this.password);
  }

  toggleRegistration(): void {
    this.registering.update(value => !value);
    this.password = '';
    this.confirmation = '';
    this.error.set('');
    this.notice.set('');
  }
  email = '';
  password = '';

  async login(): Promise<void> {
    if (this.busy() || !this.email.trim() || !this.password) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      if (this.registering()) {
        if (!this.passwordPairValid) return;
        await this.data.register(this.email, this.password);
        this.registering.set(false);
        this.notice.set('Письмо отправлено. Подтвердите почту, затем войдите.');
        return;
      }
      await this.data.login(this.email, this.password);
      await this.router.navigateByUrl('/computers');
    } catch (error) {
      this.error.set(messageFor(error));
    } finally {
      this.password = '';
      this.confirmation = '';
      this.busy.set(false);
    }
  }
}
