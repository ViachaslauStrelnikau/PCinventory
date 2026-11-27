import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InventoryData, messageFor } from './core/inventory-data';
import { meetsPasswordPolicy, passwordHint, passwordMaxLength, passwordMinLength } from './core/password-policy';

@Component({
  selector: 'app-change-password',
  imports: [FormsModule],
  template: `
    <form class="panel editor" aria-labelledby="change-password-title" (ngSubmit)="save()" #form="ngForm">
      <fieldset [disabled]="busy()">
        <h2 id="change-password-title">Смена пароля</h2>
        <div class="form-grid">
          <label>Текущий пароль<input name="currentPassword" type="password" required
            autocomplete="current-password" [(ngModel)]="currentPassword"></label>
          <label>Новый пароль<input name="newPassword" type="password" required [minlength]="minLength" [maxlength]="maxLength"
            autocomplete="new-password" aria-describedby="new-password-rule" [(ngModel)]="newPassword"></label>
          <label>Повторите новый пароль<input name="newPasswordConfirmation" type="password" required [maxlength]="maxLength"
            autocomplete="new-password" aria-describedby="new-password-mismatch" [(ngModel)]="confirmation"></label>
        </div>
        <p class="muted editor-actions" id="new-password-rule">{{ hint }}</p>
        <div id="new-password-mismatch" aria-live="polite">
          @if (confirmation && newPassword !== confirmation) { <p class="danger-text">Новые пароли не совпадают.</p> }
        </div>
        @if (error()) { <p role="alert" class="notice error">{{ error() }}</p> }
        @if (saved()) { <p role="status" class="notice success">Пароль изменён.</p> }
        <div class="actions editor-actions">
          <button class="primary" type="submit" [class.is-spinning]="busy()" [disabled]="!form.valid || !ready || busy()">
            {{ busy() ? 'Сохранение…' : 'Сменить пароль' }}
          </button>
        </div>
      </fieldset>
    </form>`,
})
export class ChangePassword {
  private readonly data = inject(InventoryData);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly saved = signal(false);
  readonly hint = passwordHint;
  readonly minLength = passwordMinLength;
  readonly maxLength = passwordMaxLength;
  currentPassword = '';
  newPassword = '';
  confirmation = '';

  get ready(): boolean {
    return !!this.currentPassword && meetsPasswordPolicy(this.newPassword) && this.newPassword === this.confirmation;
  }

  async save(): Promise<void> {
    if (!this.ready || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.saved.set(false);
    try {
      await this.data.changePassword(this.currentPassword, this.newPassword);
      this.saved.set(true);
    } catch (error) {
      this.error.set(messageFor(error));
    } finally {
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmation = '';
      this.busy.set(false);
    }
  }
}
