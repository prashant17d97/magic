import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const COST = 16_384;
const KEY_LENGTH = 64;
const FORMAT = 'scrypt';

/**
 * Password hashing with scrypt from the Node standard library. A dedicated dependency would buy
 * argon2, which is marginally stronger, at the cost of a native build in every container image;
 * scrypt at these parameters is well inside the range that makes offline cracking impractical.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${FORMAT}$${COST}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

/**
 * Comparison is constant-time and a malformed stored hash returns false rather than throwing,
 * so a corrupted row denies access instead of producing a 500 that leaks its existence.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== FORMAT) return false;

  const saltPart = parts[2];
  const hashPart = parts[3];
  if (!saltPart || !hashPart) return false;

  try {
    const salt = Buffer.from(saltPart, 'base64url');
    const expected = Buffer.from(hashPart, 'base64url');
    const derived = await scrypt(password, salt, expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
