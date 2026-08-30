/**
 * Fixtures are anchored to a fixed instant rather than to `now`. Two consequences matter: the
 * corpus produces the same exception set on any machine on any day, and maturity windows can be
 * exercised precisely instead of by waiting.
 */
export const FIXTURE_NOW = new Date('2026-08-29T12:00:00.000Z');

export function hoursBefore(hours: number): string {
  return new Date(FIXTURE_NOW.getTime() - hours * 3_600_000).toISOString();
}

export function daysBefore(days: number): string {
  return hoursBefore(days * 24);
}

/**
 * A small deterministic generator. Fixture data needs variety so the console does not look like
 * a test harness, but every value must be reproducible, which rules out Math.random.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    let hash = 2_166_136_261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16_777_619);
    }
    this.state = hash >>> 0 || 1;
  }

  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    this.state >>>= 0;
    return this.state / 0xffff_ffff;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('SeededRandom.pick was called with an empty list.');
    return item;
  }
}
