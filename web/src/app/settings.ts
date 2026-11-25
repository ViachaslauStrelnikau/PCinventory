import { Component, inject, signal } from '@angular/core';
import { InventoryData, messageFor } from './core/inventory-data';

@Component({
  template: `
    <header class="page-heading"><div><h1>Настройки</h1><p>Управление инвентаризацией</p></div></header>
    @if (error()) { <p class="notice error" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="notice success" role="status">{{ notice() }}</p> }
    <section class="panel section settings-section" aria-labelledby="intake-title">
      <div>
        <h2 id="intake-title">Приём отчётов</h2>
        <p class="muted">Разрешить настольным агентам отправлять новые отчёты.</p>
      </div>
      @if (enabled() !== null) {
        <label class="switch-label">
          <input class="switch" type="checkbox" role="switch" aria-label="Приём отчётов" [checked]="enabled()" [disabled]="busy()" (change)="change($event.target)">
          {{ enabled() ? 'Включён' : 'Выключен' }}
        </label>
      } @else if (busy()) {
        <span role="status">Загрузка…</span>
      } @else {
        <button type="button" (click)="load()">Повторить загрузку</button>
      }
    </section>
    <section class="panel section settings-section" aria-labelledby="backup-title">
      <div><h2 id="backup-title">Резервное копирование</h2><p class="muted">Создание и восстановление резервных копий появятся в будущем этапе.</p></div>
      <button type="button" disabled>Создать копию</button>
    </section>
  `,
})
export class Settings {
  private readonly data = inject(InventoryData);
  readonly enabled = signal<boolean | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  constructor() { void this.load(); }

  async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.enabled.set(await this.data.intake());
    } catch (error) {
      this.error.set(messageFor(error));
    } finally {
      this.busy.set(false);
    }
  }

  async change(control: HTMLInputElement): Promise<void> {
    const next = control.checked;
    control.checked = this.enabled() === true;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.data.setIntake(next);
      this.enabled.set(next);
      this.notice.set(next ? 'Приём отчётов включён.' : 'Приём отчётов выключен.');
    } catch (error) {
      this.error.set(messageFor(error));
    } finally {
      this.busy.set(false);
    }
  }
}
