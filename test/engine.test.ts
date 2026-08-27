import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attack, attackTargets, buy, canFound, checkWinner, createGame, endTurn, foundCity, moveUnit, reachable,
  setProduction, unitsOf, citiesOf, MAX_HP, NEUTRAL, TERRAIN, UNITS,
  type GameState, type Settings, type Terrain, type Unit,
} from '../src/lib/engine.ts';
import { distance, hexLine, neighbors } from '../src/lib/hex.ts';
import { playAiTurn } from '../src/lib/ai.ts';

const settings: Settings = { width: 11, height: 9, seed: 'test-seed', turnLimit: 20 };
const twoPlayers = () => createGame(settings, [{ name: 'Ada', kind: 'human' }, { name: 'Bot', kind: 'ai' }]);

/** A hand-built state: flat plains, one warrior each, a forest and a lake near player 0. */
function flatState(): GameState {
  const s = twoPlayers();
  const tiles: Terrain[] = s.tiles.map(() => 'plains');
  const set = (q: number, r: number, t: 'forest' | 'hills' | 'water') => {
    tiles[r * settings.width + q] = t;
  };
  set(5, 4, 'forest');
  set(6, 4, 'hills');
  set(4, 5, 'water');
  const units: Unit[] = [
    { id: 100, type: 'warrior', owner: 0, q: 4, r: 4, hp: MAX_HP, moves: 2, attacked: false, acted: false },
    { id: 101, type: 'warrior', owner: 1, q: 9, r: 7, hp: MAX_HP, moves: 2, attacked: false, acted: false },
  ];
  return { ...s, tiles, units, cities: s.cities.filter((c) => c.owner !== NEUTRAL) };
}

test('hex geometry: neighbours are at distance 1 and lines are contiguous', () => {
  const h = { q: 3, r: 3 };
  for (const n of neighbors(h)) assert.equal(distance(h, n), 1);
  const line = hexLine({ q: 0, r: 0 }, { q: 6, r: 5 });
  for (let i = 1; i < line.length; i++) assert.equal(distance(line[i - 1], line[i]), 1);
  assert.equal(line.length, distance({ q: 0, r: 0 }, { q: 6, r: 5 }) + 1);
});

test('movement range respects terrain cost, water and occupancy', () => {
  const s = flatState();
  const u = s.units[0];
  const r = reachable(s, u);
  // plains one step, two steps
  assert.ok(r.has('3,4'));
  assert.equal(r.get('3,4')!.cost, 1);
  assert.ok(r.has('2,4'));
  assert.equal(r.get('2,4')!.cost, 2);
  // three plains steps is too far
  assert.ok(!r.has('1,4'));
  // forest costs 2 — reachable in one step, but nothing beyond it
  assert.ok(r.has('5,4'));
  assert.equal(r.get('5,4')!.cost, 2);
  assert.ok(!r.has('6,4'));
  // water is never reachable
  assert.ok(!r.has('4,5'));
  assert.equal(TERRAIN.water.move, Infinity);
  // the "one step is always allowed" rule: with 1 move left, forest is still enterable
  const tired = { ...u, moves: 1 };
  assert.ok(reachable({ ...s, units: [tired, s.units[1]] }, tired).has('5,4'));
  // an occupied tile blocks
  const blocker: Unit = { ...s.units[1], id: 102, q: 3, r: 4 };
  const r2 = reachable({ ...s, units: [u, s.units[1], blocker] }, u);
  assert.ok(!r2.has('3,4'));
  // moving spends the points
  const moved = moveUnit(s, 100, { q: 2, r: 4 });
  assert.equal(moved.units.find((x) => x.id === 100)!.moves, 0);
  assert.throws(() => moveUnit(moved, 100, { q: 1, r: 4 }));
});

test('combat is deterministic and consumes the shared RNG', () => {
  const s0 = flatState();
  const enemy: Unit = { ...s0.units[1], q: 5, r: 4 }; // in the forest, adjacent
  const s = { ...s0, units: [s0.units[0], enemy] };
  assert.deepEqual(attackTargets(s, s.units[0]).map((t) => t.id), [101]);
  const a = attack(s, 100, 101);
  const b = attack(s, 100, 101);
  assert.deepEqual(a.units, b.units);
  assert.equal(a.rng, b.rng);
  assert.notEqual(a.rng, s.rng);
  const def = a.units.find((x) => x.id === 101)!;
  assert.ok(def.hp < MAX_HP && def.hp >= 0);
  const att = a.units.find((x) => x.id === 100)!;
  assert.equal(att.moves, 0);
  assert.ok(att.attacked);
  assert.throws(() => attack(a, 100, 101), /out of range/);
  // an archer two hexes away shoots without retaliation
  const archer: Unit = { ...s.units[0], id: 103, type: 'archer', q: 3, r: 4 };
  const s2 = { ...s, units: [archer, enemy] };
  assert.equal(distance(archer, enemy), 2);
  const shot = attack(s2, 103, 101);
  assert.equal(shot.units.find((x) => x.id === 103)!.hp, MAX_HP);
  // repeated attacks from fresh copies always agree with a replay of the same sequence
  let x = s;
  let y = s;
  for (let i = 0; i < 3 && x.units.length === 2; i++) {
    const fresh = (st: GameState) => ({ ...st, units: st.units.map((u) => ({ ...u, moves: 2, attacked: false })) });
    x = attack(fresh(x), 100, 101);
    y = attack(fresh(y), 100, 101);
    assert.deepEqual(x, y);
  }
});

test('win detection: conquest and turn limit', () => {
  const s = flatState();
  // Player 1 loses its only city → eliminated → player 0 wins.
  const cityOf1 = citiesOf(s, 1)[0];
  const raider: Unit = { ...s.units[0], q: cityOf1.q, r: cityOf1.r - 1 > 0 ? cityOf1.r : cityOf1.r + 1 };
  const adj = neighbors(cityOf1).find((h) => h.q >= 0 && h.r >= 0 && h.q < settings.width && h.r < settings.height)!;
  const st = { ...s, units: [{ ...raider, ...adj }] };
  const won = moveUnit(st, 100, cityOf1);
  assert.equal(won.winner, 0);
  assert.equal(won.players[1].alive, false);
  assert.equal(citiesOf(won, 0).length, 2);
  assert.throws(() => endTurn(won), /game over/);

  // Turn limit: most cities wins, evaluated when the round counter passes the limit.
  const late = { ...s, turn: settings.turnLimit, current: 1 };
  const over = endTurn(late);
  assert.equal(over.turn, settings.turnLimit + 1);
  assert.notEqual(over.winner, null);
  const withExtra = checkWinner({ ...late, turn: settings.turnLimit + 1, cities: [...late.cities, { ...late.cities[0], id: 999, q: 8, r: 2, owner: 1 }] });
  assert.equal(withExtra.winner, 1);
});

test('cities: found, produce, grow and buy', () => {
  let s = flatState();
  const settler: Unit = { id: 200, type: 'settler', owner: 0, q: 6, r: 6, hp: MAX_HP, moves: 2, attacked: false, acted: false };
  s = { ...s, units: [...s.units, settler] };
  assert.ok(canFound(s, settler));
  const nearOwn = { ...settler, q: citiesOf(s, 0)[0].q, r: citiesOf(s, 0)[0].r + 1 };
  assert.ok(!canFound({ ...s, units: [nearOwn] }, nearOwn));
  s = foundCity(s, 200);
  assert.equal(citiesOf(s, 0).length, 2);
  assert.ok(!s.units.some((u) => u.id === 200));
  // production: a warrior costs 15 shields; pop-2 capital yields 3/turn → done after 5 own turns
  const capital = citiesOf(s, 0)[0];
  s = setProduction(s, capital.id, 'warrior');
  const before = unitsOf(s, 0).length;
  for (let i = 0; i < 5; i++) {
    s = endTurn(s); // → player 1
    s = endTurn(s); // → player 0
  }
  assert.equal(unitsOf(s, 0).length, before + 1);
  assert.equal(citiesOf(s, 0)[0].pop, 3); // grew once after 5 turns
  assert.ok(s.players[0].gold > 10);
  // buying walls
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, gold: 100 } : p)) };
  s = buy(s, capital.id, 'walls');
  assert.ok(citiesOf(s, 0)[0].walls);
  assert.equal(s.players[0].gold, 50);
  assert.equal(UNITS.warrior.cost, 15);
});

test('the AI plays a full game to completion deterministically', () => {
  const play = () => {
    let s = createGame({ ...settings, turnLimit: 12 }, [{ name: 'A', kind: 'ai' }, { name: 'B', kind: 'ai' }, { name: 'C', kind: 'ai' }]);
    let guard = 0;
    while (s.winner === null && guard++ < 200) s = playAiTurn(s);
    return s;
  };
  const a = play();
  const b = play();
  assert.notEqual(a.winner, null);
  assert.deepEqual(a, b);
  assert.ok(a.seq > 3);
});
