// Pointy-top hex grid in "odd-r" offset coordinates (row r, column q; odd rows
// are shifted right by half a hex). Cube coordinates are used for distance and
// neighbour math. Pure functions only — shared by the engine, the AI and the map.

export interface Hex {
  q: number;
  r: number;
}

export interface Cube {
  x: number;
  y: number;
  z: number;
}

export const key = (h: Hex): string => `${h.q},${h.r}`;
export const same = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

export function toCube(h: Hex): Cube {
  const x = h.q - (h.r - (h.r & 1)) / 2;
  const z = h.r;
  return { x, y: -x - z, z };
}

export function fromCube(c: Cube): Hex {
  return { q: c.x + (c.z - (c.z & 1)) / 2, r: c.z };
}

export function distance(a: Hex, b: Hex): number {
  const ca = toCube(a);
  const cb = toCube(b);
  return Math.max(Math.abs(ca.x - cb.x), Math.abs(ca.y - cb.y), Math.abs(ca.z - cb.z));
}

const CUBE_DIRS: Cube[] = [
  { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: -1 },
  { x: -1, y: 1, z: 0 },
  { x: -1, y: 0, z: 1 },
  { x: 0, y: -1, z: 1 },
];

/** The six neighbours of a hex (unbounded — callers clip to the map). */
export function neighbors(h: Hex): Hex[] {
  const c = toCube(h);
  return CUBE_DIRS.map((d) => fromCube({ x: c.x + d.x, y: c.y + d.y, z: c.z + d.z }));
}

/** All hexes within `radius` of `h` (including `h`), unbounded. */
export function ring(h: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  const c = toCube(h);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = Math.max(-radius, -dx - radius); dy <= Math.min(radius, -dx + radius); dy++) {
      const dz = -dx - dy;
      out.push(fromCube({ x: c.x + dx, y: c.y + dy, z: c.z + dz }));
    }
  }
  return out;
}

// ── rendering geometry ─────────────────────────────────────────────────────────

/** Pixel centre of a hex for a pointy-top layout with the given size (circumradius). */
export function hexCenter(h: Hex, size: number): { x: number; y: number } {
  const w = Math.sqrt(3) * size;
  const x = w * (h.q + 0.5 * (h.r & 1)) + w / 2;
  const y = size * 1.5 * h.r + size;
  return { x, y };
}

/** SVG polygon points string for a pointy-top hex centred at (cx, cy). */
export function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** Bounding box of a whole map in pixels. */
export function mapPixelSize(width: number, height: number, size: number): { w: number; h: number } {
  const w = Math.sqrt(3) * size * (width + 0.5);
  const h = size * 1.5 * (height - 1) + 2 * size;
  return { w, h };
}

function cubeRound(x: number, y: number, z: number): Cube {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

/** Hexes on the straight line from a to b (inclusive). */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  if (n === 0) return [a];
  const ca = toCube(a);
  const cb = toCube(b);
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(
      fromCube(
        cubeRound(
          ca.x + (cb.x - ca.x) * t + 1e-6,
          ca.y + (cb.y - ca.y) * t + 1e-6,
          ca.z + (cb.z - ca.z) * t - 2e-6,
        ),
      ),
    );
  }
  return out;
}
