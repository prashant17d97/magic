import type { OrderSourceAdapter } from './contract.js';

export type AdapterFactory = (config: Record<string, unknown>) => OrderSourceAdapter;

/**
 * Adapters register by name and are resolved from the `adapter` column on the connection row.
 * Adding Shopify is a registration plus an implementation, with no change above this file.
 */
export class OrderSourceRegistry {
  private readonly factories = new Map<string, AdapterFactory>();

  register(name: string, factory: AdapterFactory): void {
    this.factories.set(name, factory);
  }

  create(name: string, config: Record<string, unknown>): OrderSourceAdapter {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`No order source adapter registered under "${name}". Registered: ${[...this.factories.keys()].join(', ') || 'none'}`);
    }
    return factory(config);
  }

  names(): string[] {
    return [...this.factories.keys()].sort();
  }
}
