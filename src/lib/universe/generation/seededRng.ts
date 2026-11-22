/**
 * Deterministic PRNG adapted from the Helios generator architecture (ISC).
 * The generator uses a string hash plus Mulberry32-style stepping so every
 * galaxy/system/body can be regenerated from a compact seed.
 */
export function hashSeed(input: string | number): number {
  const text = String(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 1;
}

export class SeededRng {
  readonly seed: number;
  private state: number;

  constructor(seed: string | number) {
    this.seed = hashSeed(seed);
    this.state = this.seed;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  gaussian(mean = 0, deviation = 1): number {
    const u1 = Math.max(this.next(), 1e-7);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
    return mean + z * deviation;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  fork(label: string): SeededRng {
    return new SeededRng(`${this.seed}:${label}`);
  }
}
