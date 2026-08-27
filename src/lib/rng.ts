// Tiny deterministic PRNG (mulberry32). The engine keeps the 32-bit state inside
// the game state, so every player's client — and every replay — draws the same
// numbers in the same order. Pure: `next(state)` returns the new state + value.

export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** One mulberry32 step: returns the next state and a float in [0, 1). */
export function next(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [s, value];
}

/** Stateful convenience wrapper for setup code (map generation). */
export function makeRng(seed: number): { float: () => number; int: (max: number) => number; state: () => number } {
  let s = seed >>> 0;
  const float = () => {
    const [ns, v] = next(s);
    s = ns;
    return v;
  };
  return {
    float,
    int: (max: number) => Math.floor(float() * max),
    state: () => s,
  };
}
