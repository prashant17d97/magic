import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { csrfMatches, newCsrfToken, newSessionId, signValue, verifySigned } from './tokens.js';
import { REDACTED, redact } from './redaction.js';
import { escapeCsvCell, toCsvRow } from './csv.js';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('magic-dev-password');
    expect(await verifyPassword('magic-dev-password', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('magic-dev-password');
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('produces a different hash for the same password each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('denies rather than throws on a malformed stored hash', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$16384$$')).toBe(false);
  });
});

describe('signed values', () => {
  it('verifies a value it signed', () => {
    const signed = signValue('session-abc', 'secret');
    expect(verifySigned(signed, 'secret')).toBe('session-abc');
  });

  it('rejects a value signed with a different key', () => {
    expect(verifySigned(signValue('session-abc', 'secret'), 'other')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const signed = signValue('session-abc', 'secret');
    expect(verifySigned(signed.replace('abc', 'xyz'), 'secret')).toBeNull();
  });

  it('issues session identifiers that do not repeat', () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

describe('csrf double submit', () => {
  it('accepts a matching pair', () => {
    const token = newCsrfToken();
    expect(csrfMatches(token, token)).toBe(true);
  });

  it('rejects a missing or mismatched token', () => {
    expect(csrfMatches(undefined, 'x')).toBe(false);
    expect(csrfMatches('a', 'b')).toBe(false);
  });
});

describe('log redaction', () => {
  it('removes headers that carry authority', () => {
    const output = redact({ authorization: 'Bearer abc', 'stripe-signature': 't=1,v1=xyz' }) as Record<string, unknown>;
    expect(output['authorization']).toBe(REDACTED);
    expect(output['stripe-signature']).toBe(REDACTED);
  });

  it('removes any key that looks like a credential', () => {
    const output = redact({ apiKeyRef: 'x', webhook_secret: 'y', amount: 100 }) as Record<string, unknown>;
    expect(output['apiKeyRef']).toBe(REDACTED);
    expect(output['webhook_secret']).toBe(REDACTED);
    expect(output['amount']).toBe(100);
  });

  it('scrubs a Stripe key that appears inside free text', () => {
    expect(redact('failed with sk_live_abc123456789')).toBe(`failed with ${REDACTED}`);
  });

  it('walks nested structures without unbounded recursion', () => {
    const output = redact({ a: { b: { c: { token: 'x' } } } }) as Record<string, Record<string, Record<string, Record<string, string>>>>;
    expect(output['a']?.['b']?.['c']?.['token']).toBe(REDACTED);
  });
});

describe('csv escaping', () => {
  it('neutralises a formula a merchant could have supplied', () => {
    expect(escapeCsvCell('=cmd|/c calc')).toBe("'=cmd|/c calc");
    expect(escapeCsvCell('=HYPERLINK("http://x","go")')).toBe('"\'=HYPERLINK(""http://x"",""go"")"');
    expect(escapeCsvCell('+1234')).toBe("'+1234");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes and escapes embedded quotes and separators', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('renders an absent value as an empty cell', () => {
    expect(toCsvRow(['a', null, undefined, 1])).toBe('a,,,1');
  });
});
