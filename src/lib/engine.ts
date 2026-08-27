// Hex conquest rules engine. Everything here is a pure function of the game state:
// no I/O, no globals, no Math.random — randomness comes from the mulberry32 state
// stored in `GameState.rng`, so every client (and every replay) computes the same
// result from the same inputs. Actions throw on illegal input; the UI only offers
// legal ones, and the tests check the throws.

import { distance, hexLine, key, neighbors, ring, same, type Hex } from './hex.ts';
import { hashSeed, makeRng, next } from './rng.ts';

// ── vocabulary ─────────────────────────────────────────────────────────────────

export type Terrain = 'plains' | 'forest' | 'hills' | 'water';
export type UnitType = 'settler' | 'warrior' | 'archer';
export type Production = UnitType | 'walls';
export type PlayerKind = 'human' | 'ai';

export interface TerrainInfo {
  label: string;
  /** Movement points needed to enter. */
  move: number;
  /** Added to a defender's defence when standing here. */
  defence: number;
}

export const TERRAIN: Record<Terrain, TerrainInfo> = {
  plains: { label: 'Plains', move: 1, defence: 0 },
  forest: { label: 'Forest', move: 2, defence: 1 },
  hills: { label: 'Hills', move: 2, defence: 2 },
  water: { label: 'Water', move: Infinity, defence: 0 },
};

export interface UnitInfo {
  label: string;
  attack: number;
  defence: number;
  moves: number;
  /** Attack range in hexes (1 = melee). */
  range: number;
  /** Production shields to build. */
  cost: number;
  /** Gold to buy outright. */
  price: number;
  blurb: string;
}

export const UNITS: Record<UnitType, UnitInfo> = {
  settler: { label: 'Settler', attack: 0, defence: 1, moves: 2, range: 0, cost: 25, price: 50, blurb: 'Founds a new city.' },
  warrior: { label: 'Warrior', attack: 3, defence: 2, moves: 2, range: 1, cost: 15, price: 30, blurb: 'Sturdy melee unit. Captures cities.' },
  archer: { label: 'Archer', attack: 3, defence: 1, moves: 2, range: 2, cost: 20, price: 40, blurb: 'Shoots 2 hexes away without retaliation.' },
};

export const WALLS = { label: 'Walls', cost: 25, price: 50, defence: 2, blurb: 'Defenders in this city get +2 defence.' };
export const MAX_HP = 10;
export const MAX_POP = 6;
export const GROWTH_TURNS = 5;
export const CITY_DEFENCE = 1;
export const MIN_CITY_GAP = 3; // hexes between city centres
export const START_GOLD = 10;
export const NEUTRAL = -1;

export const CITY_NAMES = [
  'Ashford', 'Brindle', 'Corvane', 'Dunmere', 'Elsmoor', 'Farrow', 'Glenholt', 'Harrowgate',
  'Ironvale', 'Juniper', 'Kestrel', 'Lowmarsh', 'Mirefell', 'Northam', 'Oakhaven', 'Pellmont',
  'Quillstone', 'Ravenrock', 'Saltmere', 'Thornwick', 'Umberly', 'Vexley', 'Wrenfield', 'Yarrow',
];

// ── state ──────────────────────────────────────────────────────────────────────

export interface Settings {
  width: number;
  height: number;
  seed: string;
  turnLimit: number;
}

export interface PlayerState {
  name: string;
  kind: PlayerKind;
  gold: number;
  alive: boolean;
}

export interface Unit extends Hex {
  id: number;
  type: UnitType;
  owner: number;
  hp: number;
  moves: number;
  attacked: boolean;
  /** True once the unit moved or attacked this turn (no healing next turn). */
  acted: boolean;
}

export interface City extends Hex {
  id: number;
  name: string;
  owner: number; // NEUTRAL for unclaimed cities
  pop: number;
  walls: boolean;
  production: Production | null;
  progress: number;
  growth: number;
}

export interface GameState {
  settings: Settings;
  /** Number of completed player-turns since setup (also the turn file number). */
  seq: number;
  /** Round number, 1-based. */
  turn: number;
  /** Index of the player whose turn it is. */
  current: number;
  tiles: Terrain[]; // row-major, index = r * width + q
  cities: City[];
  units: Unit[];
  players: PlayerState[];
  rng: number;
  nextId: number;
  winner: number | null;
  log: string[];
}

export interface PlayerSpec {
  name: string;
  kind: PlayerKind;
}

// ── helpers ────────────────────────────────────────────────────────────────────

const assert = (cond: unknown, msg: string): void => {
  if (!cond) throw new Error(msg);
};

export const inBounds = (s: GameState, h: Hex): boolean =>
  h.q >= 0 && h.r >= 0 && h.q < s.settings.width && h.r < s.settings.height;

export const terrainAt = (s: GameState, h: Hex): Terrain => s.tiles[h.r * s.settings.width + h.q];
export const unitAt = (s: GameState, h: Hex): Unit | undefined => s.units.find((u) => same(u, h));
export const cityAt = (s: GameState, h: Hex): City | undefined => s.cities.find((c) => same(c, h));
export const unitById = (s: GameState, id: number): Unit | undefined => s.units.find((u) => u.id === id);
export const cityById = (s: GameState, id: number): City | undefined => s.cities.find((c) => c.id === id);
export const isLand = (s: GameState, h: Hex): boolean => inBounds(s, h) && terrainAt(s, h) !== 'water';
export const landNeighbors = (s: GameState, h: Hex): Hex[] => neighbors(h).filter((n) => isLand(s, n));

/** Defence a unit standing on `h` gets from terrain, city and walls. */
export function defenceBonus(s: GameState, h: Hex): number {
  let b = TERRAIN[terrainAt(s, h)].defence;
  const c = cityAt(s, h);
  if (c) b += CITY_DEFENCE + (c.walls ? WALLS.defence : 0);
  return b;
}

export const citiesOf = (s: GameState, p: number): City[] => s.cities.filter((c) => c.owner === p);
export const unitsOf = (s: GameState, p: number): Unit[] => s.units.filter((u) => u.owner === p);
export const cityYield = (c: City): { shields: number; gold: number } => ({ shields: 1 + c.pop, gold: 1 + c.pop });
export const productionCost = (p: Production): number => (p === 'walls' ? WALLS.cost : UNITS[p].cost);
export const productionPrice = (p: Production): number => (p === 'walls' ? WALLS.price : UNITS[p].price);

const withLog = (s: GameState, line: string): GameState => ({ ...s, log: [...s.log.slice(-39), line] });

// ── setup ──────────────────────────────────────────────────────────────────────

export function createGame(settings: Settings, specs: PlayerSpec[]): GameState {
  assert(specs.length >= 2 && specs.length <= 4, '2–4 players');
  const { width, height } = settings;
  assert(width >= 7 && height >= 6, 'map too small');
  const rng = makeRng(hashSeed(settings.seed));

  // Terrain: weighted noise, then one smoothing pass to make blobs instead of static.
  const pick = (): Terrain => {
    const v = rng.float();
    if (v < 0.44) return 'plains';
    if (v < 0.66) return 'forest';
    if (v < 0.84) return 'hills';
    return 'water';
  };
  let tiles: Terrain[] = Array.from({ length: width * height }, pick);
  const draft: GameState = {
    settings, seq: 0, turn: 1, current: 0, tiles, cities: [], units: [],
    players: [], rng: 0, nextId: 1, winner: null, log: [],
  };
  const smoothed = tiles.slice();
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const ns = neighbors({ q, r }).filter((n) => inBounds(draft, n));
      const count: Partial<Record<Terrain, number>> = {};
      for (const n of ns) count[terrainAt(draft, n)] = (count[terrainAt(draft, n)] ?? 0) + 1;
      const best = (Object.entries(count) as [Terrain, number][]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 4 && rng.float() < 0.7) smoothed[r * width + q] = best[0];
    }
  }
  tiles = smoothed;
  draft.tiles = tiles;

  // Start positions: spread around the map edge, nudged to the nearest land.
  const anchors: Hex[] = [
    { q: 1, r: 1 },
    { q: width - 2, r: height - 2 },
    { q: width - 2, r: 1 },
    { q: 1, r: height - 2 },
  ].slice(0, specs.length);
  const cities: City[] = [];
  const units: Unit[] = [];
  let nextId = 1;
  const taken: Hex[] = [];
  const nearestGood = (target: Hex): Hex => {
    let best: Hex | null = null;
    let bestScore = -Infinity;
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) {
        const h = { q, r };
        if (terrainAt(draft, h) === 'water') continue;
        if (taken.some((t) => distance(t, h) < MIN_CITY_GAP + 1)) continue;
        const score = -distance(h, target) * 2 + landNeighbors(draft, h).length;
        if (score > bestScore) {
          bestScore = score;
          best = h;
        }
      }
    }
    assert(best, 'no land for a start position');
    return best!;
  };
  const players: PlayerState[] = specs.map((p) => ({ name: p.name, kind: p.kind, gold: START_GOLD, alive: true }));
  let nameIdx = rng.int(CITY_NAMES.length);
  const cityName = () => CITY_NAMES[nameIdx++ % CITY_NAMES.length];
  specs.forEach((_, i) => {
    const h = nearestGood(anchors[i]);
    taken.push(h);
    tiles[h.r * width + h.q] = 'plains';
    cities.push({ id: nextId++, name: cityName(), owner: i, ...h, pop: 2, walls: false, production: 'warrior', progress: 0, growth: 0 });
    units.push({ id: nextId++, type: 'warrior', owner: i, ...h, hp: MAX_HP, moves: UNITS.warrior.moves, attacked: false, acted: false });
  });

  // Neutral cities: free real estate for whoever walks in first.
  const neutralCount = Math.max(1, Math.round((width * height) / 40));
  for (let i = 0; i < neutralCount; i++) {
    const cands: Hex[] = [];
    for (let r = 1; r < height - 1; r++) {
      for (let q = 1; q < width - 1; q++) {
        const h = { q, r };
        if (terrainAt(draft, h) === 'water') continue;
        if (taken.some((t) => distance(t, h) < MIN_CITY_GAP + 1)) continue;
        cands.push(h);
      }
    }
    if (!cands.length) break;
    const h = cands[rng.int(cands.length)];
    taken.push(h);
    cities.push({ id: nextId++, name: cityName(), owner: NEUTRAL, ...h, pop: 1, walls: false, production: null, progress: 0, growth: 0 });
  }

  // Connectivity: every city must be reachable over land from the first one.
  const state: GameState = { ...draft, tiles, cities, units, players, nextId, rng: rng.state() };
  const reachableLand = (from: Hex): Set<string> => {
    const seen = new Set<string>([key(from)]);
    const stack = [from];
    while (stack.length) {
      const h = stack.pop()!;
      for (const n of landNeighbors(state, h)) {
        if (!seen.has(key(n))) {
          seen.add(key(n));
          stack.push(n);
        }
      }
    }
    return seen;
  };
  for (const c of cities.slice(1)) {
    const seen = reachableLand(cities[0]);
    if (seen.has(key(c))) continue;
    // Bridge to the closest reachable land tile.
    let target: Hex = cities[0];
    let best = Infinity;
    for (const k of seen) {
      const [q, r] = k.split(',').map(Number);
      const d = distance(c, { q, r });
      if (d < best) {
        best = d;
        target = { q, r };
      }
    }
    for (const h of hexLine(c, target)) {
      if (inBounds(state, h) && terrainAt(state, h) === 'water') tiles[h.r * width + h.q] = 'plains';
    }
  }
  return withLog(state, `Turn 1 — ${players[0].name} to move.`);
}

// ── movement ───────────────────────────────────────────────────────────────────

export interface Step {
  cost: number;
  from: string | null;
}

/** Whether `unit` may end (or pass through) on `h`: cities of others are enter-and-stop. */
function entryKind(s: GameState, unit: Unit, h: Hex): 'blocked' | 'pass' | 'stop' {
  if (!isLand(s, h)) return 'blocked';
  const occ = unitAt(s, h);
  if (occ && occ.id !== unit.id) return 'blocked';
  const c = cityAt(s, h);
  if (c && c.owner !== unit.owner) return UNITS[unit.type].attack > 0 ? 'stop' : 'blocked';
  return 'pass';
}

/**
 * Dijkstra over movement points. A unit with any movement left may always enter an
 * adjacent tile (the classic "one step is always allowed" rule) — the cost is capped
 * at what it has. Returns a map from hex key to the cheapest cost and predecessor.
 */
export function reachable(s: GameState, unit: Unit): Map<string, Step> {
  const out = new Map<string, Step>();
  if (unit.moves <= 0 || s.winner !== null) return out;
  const dist = new Map<string, number>([[key(unit), 0]]);
  const prev = new Map<string, string | null>([[key(unit), null]]);
  const open: Hex[] = [unit];
  while (open.length) {
    open.sort((a, b) => dist.get(key(a))! - dist.get(key(b))!);
    const h = open.shift()!;
    const d = dist.get(key(h))!;
    if (d >= unit.moves) continue;
    if (!same(h, unit) && entryKind(s, unit, h) === 'stop') continue;
    for (const n of neighbors(h)) {
      const kind = entryKind(s, unit, n);
      if (kind === 'blocked') continue;
      const nd = Math.min(unit.moves, d + TERRAIN[terrainAt(s, n)].move);
      if (nd < (dist.get(key(n)) ?? Infinity)) {
        dist.set(key(n), nd);
        prev.set(key(n), key(h));
        open.push(n);
      }
    }
  }
  for (const [k, cost] of dist) {
    if (k === key(unit)) continue;
    out.set(k, { cost, from: prev.get(k) ?? null });
  }
  return out;
}

export function moveUnit(s: GameState, unitId: number, to: Hex): GameState {
  const unit = unitById(s, unitId);
  assert(unit, 'no such unit');
  assert(unit!.owner === s.current, 'not your unit');
  const step = reachable(s, unit!).get(key(to));
  assert(step, 'destination not reachable');
  let next: GameState = {
    ...s,
    units: s.units.map((u) => (u.id === unitId ? { ...u, q: to.q, r: to.r, moves: u.moves - step!.cost, acted: true } : u)),
  };
  const city = cityAt(next, to);
  if (city && city.owner !== unit!.owner) next = captureCity(next, city, unit!.owner);
  return next;
}

function captureCity(s: GameState, city: City, by: number): GameState {
  const prevOwner = city.owner;
  let next: GameState = {
    ...s,
    cities: s.cities.map((c) =>
      c.id === city.id ? { ...c, owner: by, pop: Math.max(1, c.pop - 1), production: 'warrior', progress: 0 } : c,
    ),
  };
  const who = prevOwner === NEUTRAL ? 'neutral' : s.players[prevOwner].name;
  next = withLog(next, `${s.players[by].name} captured ${city.name} (${who}).`);
  return checkElimination(next);
}

// ── combat ─────────────────────────────────────────────────────────────────────

export function attackTargets(s: GameState, unit: Unit): Unit[] {
  const info = UNITS[unit.type];
  if (info.attack === 0 || unit.attacked || s.winner !== null) return [];
  return s.units.filter((u) => u.owner !== unit.owner && distance(u, unit) <= info.range);
}

export interface CombatPreview {
  attack: number;
  defence: number;
  /** Expected damage to the defender (midpoint of the roll). */
  expected: number;
  retaliates: boolean;
}

function damage(att: number, def: number, roll: number, scale: number): number {
  const raw = scale * (att / (att + def)) * (0.8 + 0.4 * roll);
  return Math.max(1, Math.min(MAX_HP, Math.round(raw)));
}

export function previewAttack(s: GameState, attacker: Unit, defender: Unit): CombatPreview {
  const attack = UNITS[attacker.type].attack;
  const defence = UNITS[defender.type].defence + defenceBonus(s, defender);
  const retaliates = UNITS[attacker.type].range === 1 && UNITS[defender.type].attack > 0;
  return { attack, defence, expected: damage(attack, defence, 0.5, 6), retaliates };
}

export function attack(s: GameState, attackerId: number, defenderId: number): GameState {
  const a = unitById(s, attackerId);
  const d = unitById(s, defenderId);
  assert(a && d, 'no such unit');
  assert(a!.owner === s.current, 'not your unit');
  assert(attackTargets(s, a!).some((t) => t.id === defenderId), 'target out of range');
  const pv = previewAttack(s, a!, d!);
  const [rng0, roll] = next(s.rng);
  let rng = rng0;
  const dmg = damage(pv.attack, pv.defence, roll, 6);
  const defenderHp = d!.hp - dmg;
  let attackerHp = a!.hp;
  let line = `${s.players[a!.owner].name}'s ${UNITS[a!.type].label.toLowerCase()} hit ${ownerName(s, d!.owner)}'s ${UNITS[d!.type].label.toLowerCase()} for ${dmg}`;
  if (defenderHp > 0 && pv.retaliates) {
    const [rng2, roll2] = next(rng);
    rng = rng2;
    const back = damage(UNITS[d!.type].attack, UNITS[a!.type].defence + defenceBonus(s, a!), roll2, 4);
    attackerHp -= back;
    line += `, took ${back} back`;
  }
  line += defenderHp <= 0 ? ' — destroyed.' : attackerHp <= 0 ? ' — and fell.' : '.';
  const units = s.units
    .map((u) => {
      if (u.id === attackerId) return { ...u, hp: attackerHp, moves: 0, attacked: true, acted: true };
      if (u.id === defenderId) return { ...u, hp: defenderHp };
      return u;
    })
    .filter((u) => u.hp > 0);
  return checkElimination(withLog({ ...s, rng, units }, line));
}

const ownerName = (s: GameState, p: number): string => (p === NEUTRAL ? 'neutral' : s.players[p].name);

// ── cities ─────────────────────────────────────────────────────────────────────

export function canFoundAt(s: GameState, h: Hex): boolean {
  return isLand(s, h) && !s.cities.some((c) => distance(c, h) < MIN_CITY_GAP);
}

export function canFound(s: GameState, unit: Unit): boolean {
  return unit.type === 'settler' && unit.owner === s.current && s.winner === null && canFoundAt(s, unit);
}

export function foundCity(s: GameState, unitId: number): GameState {
  const unit = unitById(s, unitId);
  assert(unit && canFound(s, unit), 'cannot found a city here');
  const used = new Set(s.cities.map((c) => c.name));
  const name = CITY_NAMES.find((n) => !used.has(n)) ?? `City ${s.nextId}`;
  const city: City = {
    id: s.nextId, name, owner: unit!.owner, q: unit!.q, r: unit!.r,
    pop: 1, walls: false, production: 'warrior', progress: 0, growth: 0,
  };
  return withLog(
    { ...s, nextId: s.nextId + 1, cities: [...s.cities, city], units: s.units.filter((u) => u.id !== unitId) },
    `${s.players[unit!.owner].name} founded ${name}.`,
  );
}

export function setProduction(s: GameState, cityId: number, item: Production | null): GameState {
  const city = cityById(s, cityId);
  assert(city && city.owner === s.current, 'not your city');
  assert(item !== 'walls' || !city!.walls, 'already has walls');
  return {
    ...s,
    cities: s.cities.map((c) => (c.id === cityId ? { ...c, production: item, progress: item === c.production ? c.progress : 0 } : c)),
  };
}

/** Free tile for a new unit: the city itself, else an adjacent land tile. */
export function spawnSpot(s: GameState, city: City): Hex | null {
  if (!unitAt(s, city)) return city;
  return landNeighbors(s, city).find((h) => !unitAt(s, h) && !(cityAt(s, h) && cityAt(s, h)!.owner !== city.owner)) ?? null;
}

function spawn(s: GameState, city: City, type: UnitType): GameState | null {
  const spot = spawnSpot(s, city);
  if (!spot) return null;
  const unit: Unit = { id: s.nextId, type, owner: city.owner, ...spot, hp: MAX_HP, moves: 0, attacked: true, acted: true };
  return { ...s, nextId: s.nextId + 1, units: [...s.units, unit] };
}

export function canBuy(s: GameState, city: City, item: Production): boolean {
  if (city.owner !== s.current || s.winner !== null) return false;
  if (s.players[s.current].gold < productionPrice(item)) return false;
  if (item === 'walls') return !city.walls;
  return spawnSpot(s, city) !== null;
}

export function buy(s: GameState, cityId: number, item: Production): GameState {
  const city = cityById(s, cityId);
  assert(city && canBuy(s, city, item), 'cannot buy that');
  const players = s.players.map((p, i) => (i === s.current ? { ...p, gold: p.gold - productionPrice(item) } : p));
  let next: GameState = { ...s, players };
  if (item === 'walls') {
    next = { ...next, cities: next.cities.map((c) => (c.id === cityId ? { ...c, walls: true, production: c.production === 'walls' ? null : c.production, progress: c.production === 'walls' ? 0 : c.progress } : c)) };
  } else {
    const spawned = spawn(next, city!, item);
    assert(spawned, 'no room');
    // A bought unit is ready to act right away.
    next = { ...spawned!, units: spawned!.units.map((u) => (u.id === spawned!.nextId - 1 ? { ...u, moves: UNITS[item].moves, attacked: false, acted: false } : u)) };
  }
  return withLog(next, `${s.players[s.current].name} bought ${item} in ${city!.name}.`);
}

// ── turns ──────────────────────────────────────────────────────────────────────

function processCities(s: GameState, p: number): GameState {
  let next = s;
  for (const c0 of citiesOf(s, p)) {
    const c = cityById(next, c0.id)!;
    const y = cityYield(c);
    let city: City = { ...c, growth: c.growth + 1 };
    if (city.growth >= GROWTH_TURNS && city.pop < MAX_POP) city = { ...city, growth: 0, pop: city.pop + 1 };
    next = { ...next, players: next.players.map((pl, i) => (i === p ? { ...pl, gold: pl.gold + y.gold } : pl)) };
    const prod = city.production;
    if (prod) {
      city = { ...city, progress: city.progress + y.shields };
      const cost = productionCost(prod);
      if (city.progress >= cost) {
        if (prod === 'walls') {
          city = { ...city, walls: true, production: null, progress: 0 };
          next = withLog(next, `${city.name} finished its walls.`);
        } else {
          const spawned = spawn({ ...next, cities: next.cities.map((x) => (x.id === city.id ? city : x)) }, city, prod);
          if (spawned) {
            next = withLog(spawned, `${city.name} trained a ${prod}.`);
            city = { ...city, progress: city.progress - cost };
          }
          // else: no room — progress carries over until a tile frees up.
        }
      }
    }
    next = { ...next, cities: next.cities.map((x) => (x.id === city.id ? city : x)) };
  }
  return next;
}

function startTurn(s: GameState, p: number): GameState {
  const units = s.units.map((u) => {
    if (u.owner !== p) return u;
    const inCity = cityAt(s, u)?.owner === p;
    const heal = u.acted ? 0 : inCity ? 3 : 1;
    return { ...u, moves: UNITS[u.type].moves, attacked: false, acted: false, hp: Math.min(MAX_HP, u.hp + heal) };
  });
  return { ...s, units };
}

function checkElimination(s: GameState): GameState {
  let next = s;
  s.players.forEach((pl, i) => {
    if (!pl.alive) return;
    const hasCity = citiesOf(next, i).length > 0;
    const hasSettler = unitsOf(next, i).some((u) => u.type === 'settler');
    if (!hasCity && !hasSettler) {
      next = withLog(
        { ...next, players: next.players.map((x, j) => (j === i ? { ...x, alive: false } : x)), units: next.units.filter((u) => u.owner !== i) },
        `${pl.name} has been eliminated.`,
      );
    }
  });
  return checkWinner(next);
}

/** Sets `winner` when the game is over; otherwise returns the state unchanged. */
export function checkWinner(s: GameState): GameState {
  if (s.winner !== null) return s;
  const alive = s.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1) return withLog({ ...s, winner: alive[0] }, `${s.players[alive[0]].name} wins by conquest.`);
  if (s.turn > s.settings.turnLimit) {
    const score = (i: number) => citiesOf(s, i).length * 1000 + unitsOf(s, i).reduce((a, u) => a + u.hp, 0);
    const best = alive.slice().sort((a, b) => score(b) - score(a) || a - b)[0];
    return withLog({ ...s, winner: best }, `Turn limit reached — ${s.players[best].name} wins with the most cities.`);
  }
  return s;
}

export function endTurn(s: GameState): GameState {
  assert(s.winner === null, 'game over');
  let next = processCities(s, s.current);
  next = checkElimination(next);
  if (next.winner !== null) return { ...next, seq: next.seq + 1 };
  let p = next.current;
  let turn = next.turn;
  for (let i = 0; i < next.players.length; i++) {
    p = (p + 1) % next.players.length;
    if (p === 0) turn++;
    if (next.players[p].alive) break;
  }
  next = { ...next, current: p, turn, seq: next.seq + 1 };
  next = checkWinner(next);
  if (next.winner !== null) return next;
  next = startTurn(next, p);
  return withLog(next, `Turn ${turn} — ${next.players[p].name} to move.`);
}

// ── queries for the UI / AI ────────────────────────────────────────────────────

export const hexesWithin = (s: GameState, h: Hex, radius: number): Hex[] => ring(h, radius).filter((x) => inBounds(s, x));

/** A unit still has something useful to do this turn. */
export const canAct = (s: GameState, u: Unit): boolean =>
  u.owner === s.current && (reachable(s, u).size > 0 || attackTargets(s, u).length > 0 || canFound(s, u));

/** "Ada's" — with a special case so the demo's "You" reads as "Your". */
export const possessive = (name: string): string => (name.toLowerCase() === 'you' ? 'Your' : `${name}'s`);
