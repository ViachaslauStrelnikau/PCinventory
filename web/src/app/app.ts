import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { InventoryData } from './core/inventory-data';
import { RegistryState } from './registry/registry-state';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  readonly data = inject(InventoryData);
  private readonly router = inject(Router);
  private readonly registry = inject(RegistryState);

  async logout(): Promise<void> {
    this.registry.reset();
    try {
      await this.data.logout();
    } finally {
      await this.router.navigateByUrl('/login');
    }
  }
}
