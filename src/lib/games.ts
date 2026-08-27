// Game files on top of the Store. Layout (private store or a shared space):
//
//   <root>/games/<gameId>/game.json          immutable: settings, seats, seed
//   <root>/games/<gameId>/players/<slot>.json seat claim: { login, claimedAt }
//   <root>/games/<gameId>/turns/<NNNN>.json   full state after N completed player-turns
//
// One record = one file. Turn files are never rewritten: only the player whose
// turn it is (or any client computing a deterministic AI turn) writes the NEXT
// number, so last-write-wins on a shared space cannot clobber anyone's move.

import fs from 'fs';
import { createGame, type GameState, type PlayerKind, type Settings } from './engine.ts';
import { ensureDir, listFiles, newId, readJson, writeJson, type Store } from './store.ts';

export interface Seat {
  slot: number;
  name: string;
  kind: PlayerKind;
}

export interface GameMeta {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  settings: Settings;
  seats: Seat[];
}

export interface Claim {
  login: string;
  claimedAt: number;
}

export interface GameSummary {
  meta: GameMeta;
  claims: (Claim | null)[];
  /** Latest completed turn number, or -1 when no turn file could be read. */
  seq: number;
  state: GameState | null;
}

export const gamesRoot = (store: Store): string => `${store.root}/games`;
export const gameDir = (store: Store, id: string): string => `${gamesRoot(store)}/${id}`;
export const turnsDir = (store: Store, id: string): string => `${gameDir(store, id)}/turns`;
export const playersDir = (store: Store, id: string): string => `${gameDir(store, id)}/players`;
const pad = (n: number): string => String(n).padStart(4, '0');

export async function readClaims(store: Store, id: string, seats: number): Promise<(Claim | null)[]> {
  const out: (Claim | null)[] = [];
  for (let i = 0; i < seats; i++) out.push(await readJson<Claim | null>(`${playersDir(store, id)}/${i}.json`, null));
  return out;
}

export async function latestSeq(store: Store, id: string): Promise<number> {
  const files = await listFiles(turnsDir(store, id), '.json');
  if (!files.length) return -1;
  return Number(files[files.length - 1].replace('.json', ''));
}

export async function readTurn(store: Store, id: string, seq: number): Promise<GameState | null> {
  return readJson<GameState | null>(`${turnsDir(store, id)}/${pad(seq)}.json`, null);
}

export async function loadGame(store: Store, id: string): Promise<GameSummary | null> {
  const meta = await readJson<GameMeta | null>(`${gameDir(store, id)}/game.json`, null);
  if (!meta) return null;
  const seq = await latestSeq(store, id);
  const state = seq >= 0 ? await readTurn(store, id, seq) : null;
  const claims = await readClaims(store, id, meta.seats.length);
  return { meta, claims, seq, state };
}

export async function listGames(store: Store): Promise<GameSummary[]> {
  const ids = await listFiles(gamesRoot(store));
  const out: GameSummary[] = [];
  for (const id of ids) {
    const g = await loadGame(store, id);
    if (g) out.push(g);
  }
  return out.sort((a, b) => b.meta.createdAt - a.meta.createdAt);
}

export interface NewGameInput {
  name: string;
  settings: Settings;
  seats: Seat[];
  /** Login of the creator; claims the first human seat on a shared store. */
  login: string;
  id?: string;
}

export async function createGameFiles(store: Store, input: NewGameInput): Promise<GameSummary> {
  const id = input.id ?? newId();
  const meta: GameMeta = {
    id, name: input.name, createdAt: Date.now(), createdBy: input.login, settings: input.settings, seats: input.seats,
  };
  const state = createGame(input.settings, input.seats.map((s) => ({ name: s.name, kind: s.kind })));
  await ensureDir(turnsDir(store, id));
  await ensureDir(playersDir(store, id));
  await writeJson(`${gameDir(store, id)}/game.json`, meta);
  await writeJson(`${turnsDir(store, id)}/${pad(0)}.json`, state);
  const claims: (Claim | null)[] = input.seats.map(() => null);
  if (store.kind === 'space' && input.login) {
    const first = input.seats.find((s) => s.kind === 'human');
    if (first) {
      const claim = { login: input.login, claimedAt: Date.now() };
      await writeJson(`${playersDir(store, id)}/${first.slot}.json`, claim);
      claims[first.slot] = claim;
    }
  }
  return { meta, claims, seq: 0, state };
}

export async function writeTurn(store: Store, id: string, state: GameState): Promise<void> {
  await writeJson(`${turnsDir(store, id)}/${pad(state.seq)}.json`, state);
}

export async function claimSeat(store: Store, id: string, slot: number, login: string): Promise<Claim> {
  const claim = { login, claimedAt: Date.now() };
  await writeJson(`${playersDir(store, id)}/${slot}.json`, claim);
  return claim;
}

export async function deleteGame(store: Store, id: string): Promise<void> {
  try {
    await fs.promises.rm(gameDir(store, id), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// ── who may play the current seat ──────────────────────────────────────────────

export type SeatStatus =
  | { kind: 'ai' }
  | { kind: 'mine' }
  | { kind: 'open' } // shared store, nobody has claimed this seat yet
  | { kind: 'waiting'; login: string }
  | { kind: 'over' };

export function seatStatus(store: Store, g: GameSummary, login: string): SeatStatus {
  const s = g.state;
  if (!s) return { kind: 'waiting', login: '?' };
  if (s.winner !== null) return { kind: 'over' };
  const seat = g.meta.seats[s.current];
  if (seat.kind === 'ai') return { kind: 'ai' };
  if (store.kind !== 'space' || !login) return { kind: 'mine' }; // private / hot-seat
  const claim = g.claims[s.current];
  if (!claim) return { kind: 'open' };
  return claim.login === login ? { kind: 'mine' } : { kind: 'waiting', login: claim.login };
}

export const DEMO_ID = 'demo-solo';

/** Seeds the solo demo game once. Idempotent: skips when the folder already exists. */
export async function seedDemoGame(store: Store): Promise<boolean> {
  const existing = await readJson<GameMeta | null>(`${gameDir(store, DEMO_ID)}/game.json`, null);
  if (existing) return false;
  await createGameFiles(store, {
    id: DEMO_ID,
    name: 'Demo: you vs the computer',
    login: '',
    settings: { width: 11, height: 9, seed: 'demo', turnLimit: 30 },
    seats: [
      { slot: 0, name: 'You', kind: 'human' },
      { slot: 1, name: 'Computer', kind: 'ai' },
    ],
  });
  return true;
}
