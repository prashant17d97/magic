import type { FixtureAccount } from '../types.js';

export const PLATFORM_ACCOUNT = 'acct_platform_magic';

/**
 * A small merchant roster with deliberate variety: one healthy account, one with payouts paused
 * so suppression has something real to suppress, and one restricted so the console has a danger
 * chip to render.
 */
export const ACCOUNTS: readonly FixtureAccount[] = [
  {
    stripeAccountId: PLATFORM_ACCOUNT,
    displayName: 'Northwind Marketplace (platform)',
    country: 'US',
    currency: 'USD',
    accountType: 'standard',
    chargesEnabled: true,
    payoutsEnabled: true,
    requirementsDisabledReason: null,
  },
  {
    stripeAccountId: 'acct_acme_studio',
    displayName: 'Acme Studio',
    country: 'US',
    currency: 'USD',
    accountType: 'express',
    chargesEnabled: true,
    payoutsEnabled: true,
    requirementsDisabledReason: null,
  },
  {
    stripeAccountId: 'acct_brightside',
    displayName: 'Brightside Goods',
    country: 'GB',
    currency: 'GBP',
    accountType: 'custom',
    chargesEnabled: true,
    payoutsEnabled: true,
    requirementsDisabledReason: null,
  },
  {
    stripeAccountId: 'acct_meridian',
    displayName: 'Meridian Supply',
    country: 'US',
    currency: 'USD',
    accountType: 'express',
    chargesEnabled: true,
    payoutsEnabled: false,
    requirementsDisabledReason: 'requirements.past_due',
  },
  {
    stripeAccountId: 'acct_harbour',
    displayName: 'Harbour & Co',
    country: 'CA',
    currency: 'CAD',
    accountType: 'standard',
    chargesEnabled: false,
    payoutsEnabled: false,
    requirementsDisabledReason: 'rejected.fraud',
  },
];

export const MERCHANTS = ACCOUNTS.filter((a) => a.stripeAccountId !== PLATFORM_ACCOUNT);
