import { useCallback, useEffect, useState } from 'react';
import type { Stores } from '../hooks/useStores';
import { claimSeat, deleteGame, gamesRoot, listGames, type GameSummary } from '../lib/games';
import { pollDir, type Store } from '../lib/store';
import GameCard from './GameCard';
import NewGameForm from './NewGameForm';
import SharePanel from './SharePanel';

export type StoreKind = 'priv' | 'shared';

interface Props {
  stores: Stores;
  onOpen: (kind: StoreKind, id: string) => void;
}

function Lobby({ stores, onOpen }: Props) {
  const { priv, shared, login } = stores;
  const [tabChoice, setTab] = useState<StoreKind>('priv');
  const [loaded, setLoaded] = useState<{ root: string; list: GameSummary[] } | null>(null);
  const [showNew, setShowNew] = useState(false);
  // Jump to the shared tab when a space is opened (derived-state pattern, no effect).
  const [prevShared, setPrevShared] = useState(shared);
  if (shared !== prevShared) {
    setPrevShared(shared);
    if (shared) setTab('shared');
  }
  const tab: StoreKind = tabChoice === 'shared' && !shared ? 'priv' : tabChoice;
  const store: Store | null = tab === 'shared' ? shared : priv;
  const games = store && loaded?.root === store.root ? loaded.list : null;

  const refresh = useCallback(async () => {
    if (!store) return;
    const list = await listGames(store);
    setLoaded({ root: store.root, list });
  }, [store]);

  useEffect(() => {
    let cancelled = false;
    if (store) void listGames(store).then((list) => !cancelled && setLoaded({ root: store.root, list }));
    // Shared spaces get no remote events: poll the games folder for claims/turns.
    const stop = store?.kind === 'space' ? pollDir(gamesRoot(store), () => void refresh(), 3000) : undefined;
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [store, refresh]);

  const join = async (g: GameSummary, slot: number) => {
    if (!store || !login) return;
    await claimSeat(store, g.meta.id, slot, login);
    await refresh();
  };
  const remove = async (g: GameSummary) => {
    if (!store) return;
    await deleteGame(store, g.meta.id);
    await refresh();
  };

  return (
    <main className="wrap lobby">
      <div>
        <h1>
          Claim the map<span className="grad-text">.</span>
        </h1>
        <p className="deck">
          A small turn-based strategy game on a hex map. Found cities, train warriors and archers, and capture every
          rival city — solo against the computer, hot-seat on one device, or by taking turns through a shared space.
        </p>
      </div>

      {stores.error && <div className="error">{stores.error}</div>}

      <div className="lobby-grid">
        <section>
          <div className="sechead">
            <span className="slug">games</span>
            <h2>Your games.</h2>
            <span className="spacer" />
            {shared && (
              <div className="tabs" role="tablist">
                <button role="tab" className={`tab${tab === 'priv' ? ' active' : ''}`} type="button" onClick={() => setTab('priv')}>
                  Private
                </button>
                <button role="tab" className={`tab${tab === 'shared' ? ' active' : ''}`} type="button" onClick={() => setTab('shared')}>
                  Shared
                </button>
              </div>
            )}
          </div>
          {!store && <div className="loading">Opening your storage…</div>}
          {store && games === null && <div className="loading">Loading games…</div>}
          {store && games && games.length === 0 && <div className="empty">No games here yet — start one on the right.</div>}
          {store &&
            games?.map((g) => (
              <GameCard
                key={g.meta.id}
                store={store}
                game={g}
                login={login}
                onOpen={() => onOpen(tab, g.meta.id)}
                onJoin={(slot) => void join(g, slot)}
                onDelete={() => void remove(g)}
              />
            ))}
        </section>

        <aside style={{ display: 'grid', gap: 12 }}>
          {store && (showNew || (games && games.length === 0)) ? (
            <NewGameForm
              key={store.root}
              store={store}
              login={login}
              onCreated={(id) => {
                setShowNew(false);
                onOpen(tab, id);
              }}
            />
          ) : (
            <button className="btn btn-primary" type="button" onClick={() => setShowNew(true)} disabled={!store}>
              New game
            </button>
          )}
          <SharePanel stores={stores} />
          <div className="card">
            <h3>How to play</h3>
            <p className="hint" style={{ marginTop: 8 }}>
              Tap a unit, then a lit hex to move or a red-outlined enemy to attack. Cities build one thing at a time and
              yield gold you can spend to buy units outright. Settlers found new cities; walls make defenders tougher.
              Forests and hills give defence bonuses. Win by capturing every rival city, or hold the most cities when the
              turn limit runs out.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default Lobby;
