import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InventoryData, messageFor } from './core/inventory-data';

@Component({
  imports: [FormsModule],
  template: `
    <section class="login-card panel">
      <div class="brand">Computer Inventory</div>
      <h1>Вход в реестр</h1>
      <p class="muted">Используйте учётную запись локального эмулятора.</p>
      @if (!data.local) { <p class="alert error">Откройте приложение на localhost.</p> }
      <form class="form-stack" (ngSubmit)="login()">
        <label>Почта<input name="email" type="email" required autocomplete="username" [(ngModel)]="email"></label>
        <label>Пароль<input name="password" type="password" required autocomplete="current-password" [(ngModel)]="password"></label>
        @if (error()) { <p role="alert" class="alert error">{{ error() }}</p> }
        <button type="submit" class="button primary" [disabled]="busy() || !data.local">{{ busy() ? 'Входим…' : 'Войти' }}</button>
      </form>
    </section>`,
})
export class Login {
  readonly data = inject(InventoryData);
  private readonly router = inject(Router);
  readonly error = signal('');
  readonly busy = signal(false);
  email = '';
  password = '';

  async login(): Promise<void> {
    if (this.busy() || !this.email.trim() || !this.password) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.data.login(this.email, this.password);
      await this.router.navigateByUrl('/computers');
    } catch (error) {
      this.error.set(messageFor(error));
    } finally {
      this.password = '';
      this.busy.set(false);
    }
  }
}
