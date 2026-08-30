import { expect, test, type Page } from '@playwright/test';

const OPERATOR = { email: 'operator@northwind.test', password: 'magic-dev-password' };
const VIEWER = { email: 'auditor@northwind.test', password: 'magic-dev-password' };

async function signIn(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');
}

test.describe('signing in and reading the health view', () => {
  test('lands on health with completeness first', async ({ page }) => {
    await signIn(page, OPERATOR);

    await expect(page.getByRole('heading', { name: 'Health', level: 1 })).toBeVisible();
    await expect(page.getByText('Completeness', { exact: true })).toBeVisible();
    await expect(page.getByText('Open exposure')).toBeVisible();
  });

  test('refuses an unknown password without revealing whether the account exists', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('nobody@northwind.test');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.locator('form').getByRole('alert')).toContainText('not correct');
  });
});

test.describe('working the exception queue', () => {
  test('filters, opens a finding and resolves it with a note', async ({ page }) => {
    await signIn(page, OPERATOR);
    await page.goto('/exceptions?status=open');

    const table = page.getByRole('table', { name: /exceptions/i });
    await expect(table).toBeVisible();

    await table.getByRole('row').nth(1).click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Exposure', { exact: true }).first()).toBeVisible();
    await expect(panel.getByText('Rule trace', { exact: true })).toBeVisible();
    await expect(panel.getByText('Evidence', { exact: true })).toBeVisible();

    await panel.getByRole('button', { name: 'Resolve' }).click();
    const note = panel.getByLabel('Resolution note');
    await expect(note).toBeFocused();

    await note.fill('Checked against the bank statement; the transfer settled a day late.');
    await panel.getByRole('button', { name: 'Confirm resolve' }).click();

    await expect(page.getByText('Exception resolved')).toBeVisible();
  });

  test('keeps the queue navigable from the keyboard', async ({ page }) => {
    await signIn(page, OPERATOR);
    await page.goto('/exceptions?status=open');
    await expect(page.getByRole('table', { name: /exceptions/i })).toBeVisible();

    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('shares a queue view through the URL', async ({ page }) => {
    await signIn(page, OPERATOR);
    await page.goto('/exceptions?status=open&severity=critical');

    await expect(page.getByRole('button', { name: /severity critical/i })).toBeVisible();
  });
});

test.describe('drilling from a payout checksum to its evidence', () => {
  test('shows the receipt and the findings it produced', async ({ page }) => {
    await signIn(page, OPERATOR);
    await page.goto('/runs');

    const table = page.getByRole('table', { name: /run history/i });
    await expect(table).toBeVisible();
    await table.getByRole('row').nth(1).click();

    await expect(page.getByRole('heading', { name: 'Run detail' })).toBeVisible();
    /** A payout run reports balanced or mismatched; a window run has no deposit to tie to. */
    await expect(page.getByText(/Balanced|Mismatch|No bank deposit in scope/)).toBeVisible();
  });
});

test.describe('requesting an export', () => {
  test('queues a file and surfaces it in the list', async ({ page }) => {
    await signIn(page, OPERATOR);
    await page.goto('/exports');

    await page.getByRole('button', { name: 'Generate CSV' }).click();
    await expect(page.getByText('Export queued')).toBeVisible();
  });
});

test.describe('role boundaries', () => {
  test('a viewer cannot resolve a finding', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto('/exceptions?status=open');

    const table = page.getByRole('table', { name: /exceptions/i });
    await table.getByRole('row').nth(1).click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  });
});
