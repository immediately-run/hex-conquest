// A small heuristic opponent. Deterministic (no randomness of its own) so that two
// clients that both compute an AI turn from the same state write identical files.

import { distance, type Hex } from './hex.ts';
import {
  attack, attackTargets, buy, canBuy, canFound, canFoundAt, cityAt, citiesOf, endTurn, foundCity, landNeighbors,
  moveUnit, previewAttack, reachable, setProduction, unitAt, unitsOf, UNITS,
  type City, type GameState, type Production, type Unit,
} from './engine.ts';

const enemyCities = (s: GameState, p: number): City[] => s.cities.filter((c) => c.owner !== p);
const enemyUnits = (s: GameState, p: number): Unit[] => s.units.filter((u) => u.owner !== p && s.players[u.owner]?.alive !== false);
const nearest = <T extends Hex>(from: Hex, xs: T[]): T | undefined =>
  xs.slice().sort((a, b) => distance(from, a) - distance(from, b) || a.q - b.q || a.r - b.r)[0];

const danger = (s: GameState, p: number, h: Hex): number =>
  enemyUnits(s, p).filter((u) => UNITS[u.type].attack > 0 && distance(u, h) <= 2).length;

function bestAttack(s: GameState, u: Unit): Unit | null {
  let best: Unit | null = null;
  let bestScore = 0.75;
  for (const t of attackTargets(s, u)) {
    const pv = previewAttack(s, u, t);
    let score = pv.attack / pv.defence;
    if (pv.expected >= t.hp) score += 1.5; // kill shot
    if (t.type === 'settler') score += 1;
    if (cityAt(s, t)) score += 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function settlerTurn(s: GameState, id: number): GameState {
  let u = s.units.find((x) => x.id === id)!;
  const p = u.owner;
  if (canFound(s, u) && landNeighbors(s, u).length >= 3 && danger(s, p, u) === 0) return foundCity(s, id);
  const steps = reachable(s, u);
  let best: Hex | null = null;
  let bestScore = -Infinity;
  const own = citiesOf(s, p);
  for (const [k, step] of steps) {
    const [q, r] = k.split(',').map(Number);
    const h = { q, r };
    if (cityAt(s, h)) continue;
    let score = (canFoundAt(s, h) ? 8 : 0) + landNeighbors(s, h).length - danger(s, p, h) * 4 - step.cost * 0.1;
    const near = nearest(h, own);
    if (near) score -= Math.max(0, distance(h, near) - 4); // don't wander off
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  if (best) {
    s = moveUnit(s, id, best);
    u = s.units.find((x) => x.id === id)!;
    if (canFound(s, u) && danger(s, p, u) === 0) return foundCity(s, id);
  }
  return s;
}

function combatTurn(s: GameState, id: number): GameState {
  let u = s.units.find((x) => x.id === id);
  if (!u) return s;
  const p = u.owner;
  // 1. A good attack from where we stand.
  const t0 = bestAttack(s, u);
  if (t0) return attack(s, id, t0.id);

  // 2. Garrison: the only defender of a city stays put unless nothing threatens it.
  const home = cityAt(s, u);
  if (home && home.owner === p && unitsOf(s, p).filter((x) => cityAt(s, x)?.id === home.id).length === 1) {
    if (danger(s, p, home) > 0 || citiesOf(s, p).length <= 1) return s;
  }

  const steps = reachable(s, u);
  if (steps.size === 0) return s;
  const pick = (score: (h: Hex, cost: number) => number): Hex | null => {
    let best: Hex | null = null;
    let bestScore = -Infinity;
    for (const [k, step] of steps) {
      const [q, r] = k.split(',').map(Number);
      const sc = score({ q, r }, step.cost);
      if (sc > bestScore) {
        bestScore = sc;
        best = { q, r };
      }
    }
    return best;
  };

  // 3. Walk into an undefended enemy / neutral city.
  const freeCity = pick((h) => (cityAt(s, h) && cityAt(s, h)!.owner !== p ? 10 : -Infinity));
  if (freeCity) return moveUnit(s, id, freeCity);

  // 4. Defend: an own city with no unit and an enemy nearby.
  const threatened = citiesOf(s, p).filter((c) => !unitAt(s, c) && danger(s, p, c) > 0);
  const tc = nearest(u, threatened);
  if (tc && distance(u, tc) <= 4) {
    const towards = pick((h, cost) => -distance(h, tc) * 2 - cost * 0.1);
    if (towards && distance(towards, tc) < distance(u, tc)) {
      s = moveUnit(s, id, towards);
      u = s.units.find((x) => x.id === id)!;
      const t = bestAttack(s, u);
      return t ? attack(s, id, t.id) : s;
    }
  }

  // 5. Otherwise advance on the nearest target (weakest-looking enemy unit or a city).
  const targets: Hex[] = [...enemyCities(s, p), ...enemyUnits(s, p)];
  const goal = nearest(u, targets);
  if (!goal) return s;
  const step = pick((h, cost) => {
    let sc = -distance(h, goal) * 2 - cost * 0.1;
    sc += UNITS[u!.type].range === 2 ? -danger(s, p, h) * 1.5 : 0; // archers keep back
    sc += landNeighbors(s, h).length * 0.05;
    return sc;
  });
  if (step && distance(step, goal) < distance(u, goal)) {
    s = moveUnit(s, id, step);
    u = s.units.find((x) => x.id === id);
    if (!u) return s;
    const t = bestAttack(s, u);
    if (t) return attack(s, id, t.id);
  }
  return s;
}

function chooseProduction(s: GameState, c: City): Production {
  const p = c.owner;
  const combat = unitsOf(s, p).filter((u) => UNITS[u.type].attack > 0).length;
  const cities = citiesOf(s, p).length;
  const settlers = unitsOf(s, p).filter((u) => u.type === 'settler').length;
  const early = s.turn < s.settings.turnLimit * 0.6;
  if (combat < cities) return 'warrior';
  if (early && cities + settlers < 3 && c.pop >= 2) return 'settler';
  if (!c.walls && danger(s, p, c) > 0) return 'walls';
  if (combat < cities * 2) return 'warrior';
  return (c.id + s.turn) % 2 === 0 ? 'archer' : 'warrior';
}

/** Play the whole turn for the current (AI) player and end it. */
export function playAiTurn(s: GameState): GameState {
  const p = s.current;
  if (s.winner !== null) return s;

  // Cities: choose production, then spend gold where it matters.
  for (const c of citiesOf(s, p)) {
    if (!c.production) s = setProduction(s, c.id, chooseProduction(s, c));
  }
  for (const c0 of citiesOf(s, p)) {
    const c = s.cities.find((x) => x.id === c0.id)!;
    if (!unitAt(s, c) && canBuy(s, c, 'warrior')) s = buy(s, c.id, 'warrior');
    else if (danger(s, p, c) > 0 && canBuy(s, c, 'warrior') && s.players[p].gold >= 60) s = buy(s, c.id, 'warrior');
  }

  // Units, settlers first (they may need an escort's tile freed later — good enough).
  const order = unitsOf(s, p).slice().sort((a, b) => (a.type === 'settler' ? -1 : 1) - (b.type === 'settler' ? -1 : 1) || a.id - b.id);
  for (const u of order) {
    if (s.winner !== null) return s;
    const live = s.units.find((x) => x.id === u.id);
    if (!live) continue;
    try {
      s = live.type === 'settler' ? settlerTurn(s, u.id) : combatTurn(s, u.id);
    } catch {
      /* an illegal heuristic move — skip this unit rather than crash a turn */
    }
  }
  return s.winner === null ? endTurn(s) : s;
}

/** For the lobby: a one-line "who is ahead" summary. */
export function standings(s: GameState): string {
  return s.players
    .map((pl, i) => `${pl.name}: ${citiesOf(s, i).length} ${citiesOf(s, i).length === 1 ? 'city' : 'cities'}`)
    .join(' · ');
}

