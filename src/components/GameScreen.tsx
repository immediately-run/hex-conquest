import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  attack, attackTargets, buy, canAct, cityAt, endTurn, foundCity, moveUnit, reachable, setProduction, unitAt, unitById,
  type City, type GameState, type Production, type Unit,
} from '../lib/engine';
import { playAiTurn } from '../lib/ai';
import { key, type Hex } from '../lib/hex';
import { claimSeat, loadGame, playersDir, readTurn, seatStatus, turnsDir, writeTurn, type GameSummary } from '../lib/games';
import { pollDir, type Store } from '../lib/store';
import HexMap from './HexMap';
import TurnBanner from './TurnBanner';
import ActionBar from './ActionBar';

interface Props {
  store: Store;
  gameId: string;
  login: string;
  onExit: () => void;
}

function GameScreen({ store, gameId, login, onExit }: Props) {
  const [game, setGame] = useState<GameSummary | null | undefined>(undefined);
  const [state, setState] = useState<GameState | null>(null);
  const [selUnit, setSelUnit] = useState<number | null>(null);
  const [selCity, setSelCity] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(-1);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    void loadGame(store, gameId).then((g) => {
      if (cancelled) return;
      setGame(g);
      setState(g?.state ?? null);
      seqRef.current = g?.state?.seq ?? -1;
    });
    return () => {
      cancelled = true;
    };
  }, [store, gameId]);

  const status = useMemo(() => (game && state ? seatStatus(store, { ...game, state }, login) : null), [game, state, store, login]);
  const mine = status?.kind === 'mine' && store.mode === 'rw';

  const commit = useCallback(
    async (next: GameState) => {
      setBusy(true);
      try {
        await writeTurn(store, gameId, next);
        seqRef.current = next.seq;
        setState(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [store, gameId],
  );

  // Pull newer turns written by other players (and claims) while we are not the actor.
  useEffect(() => {
    if (!game || !status || status.kind === 'mine' || status.kind === 'over') return;
    const pull = async () => {
      const g = await loadGame(store, gameId);
      if (!g) return;
      setGame((prev) => (prev ? { ...prev, claims: g.claims } : g));
      if (g.state && g.state.seq > seqRef.current) {
        const s = await readTurn(store, gameId, g.state.seq);
        if (s && s.seq > seqRef.current) {
          seqRef.current = s.seq;
          setState(s);
          setSelUnit(null);
          setSelCity(null);
        }
      }
    };
    // Pull once up front: a claim or turn that landed while we were the actor
    // is already in the poller's baseline, so it would never fire for it.
    void pull();
    const stopTurns = pollDir(turnsDir(store, gameId), () => void pull(), 3000);
    const stopClaims = pollDir(playersDir(store, gameId), () => void pull(), 3000);
    return () => {
      stopTurns();
      stopClaims();
    };
  }, [game, status, store, gameId]);

  // Computer turns. Deterministic, so if two clients both compute it they write identical files.
  useEffect(() => {
    if (!state || status?.kind !== 'ai' || busy || store.mode !== 'rw') return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const next = playAiTurn(state);
      void commit(next);
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [state, status, busy, store.mode, commit]);

  const unit: Unit | null = state && selUnit !== null ? (unitById(state, selUnit) ?? null) : null;
  const city: City | null = state && selCity !== null ? (state.cities.find((c) => c.id === selCity) ?? null) : null;
  const reach = useMemo(() => (state && unit && mine && unit.owner === state.current ? reachable(state, unit) : new Map()), [state, unit, mine]);
  const targets = useMemo(
    () => new Set(state && unit && mine && unit.owner === state.current ? attackTargets(state, unit).map((t) => t.id) : []),
    [state, unit, mine],
  );

  const apply = (fn: (s: GameState) => GameState) => {
    if (!state) return;
    try {
      setState(fn(state));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onTap = (h: Hex) => {
    if (!state) return;
    const u = unitAt(state, h);
    const c = cityAt(state, h);
    if (unit && mine && reach.has(key(h))) {
      apply((s) => moveUnit(s, unit.id, h));
      return;
    }
    if (unit && mine && u && targets.has(u.id)) {
      apply((s) => attack(s, unit.id, u.id));
      return;
    }
    if (u && (!unit || unit.id !== u.id)) {
      setSelUnit(u.id);
      setSelCity(null);
    } else if (c && selCity !== c.id) {
      setSelCity(c.id);
      setSelUnit(null);
    } else {
      setSelUnit(null);
      setSelCity(null);
    }
  };

  const nextUnit = () => {
    if (!state) return;
    const mineUnits = state.units.filter((x) => x.owner === state.current && canAct(state, x));
    if (!mineUnits.length) return;
    const i = mineUnits.findIndex((x) => x.id === selUnit);
    const n = mineUnits[(i + 1) % mineUnits.length];
    setSelUnit(n.id);
    setSelCity(null);
  };

  const finishTurn = () => {
    if (!state) return;
    try {
      const next = endTurn(state);
      setSelUnit(null);
      setSelCity(null);
      void commit(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const claim = async () => {
    if (!game || !state || !login) return;
    const c = await claimSeat(store, gameId, state.current, login);
    setGame({ ...game, claims: game.claims.map((x, i) => (i === state.current ? c : x)) });
  };

  if (game === undefined) return <div className="loading">Loading game…</div>;
  if (!game || !state) return (
    <div className="loading">
      This game has no readable state.{' '}
      <button className="btn btn-ghost btn-sm" type="button" onClick={onExit}>
        Back to lobby
      </button>
    </div>
  );

  return (
    <div className="game">
      <TurnBanner state={state} meta={game.meta} status={status!} busy={busy} onExit={onExit} />
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        <HexMap state={state} selectedUnit={unit} selectedCityId={selCity} reach={reach} targetIds={targets} onTap={onTap} />
        {status?.kind === 'open' && (
          <div className="overlay">
            <div className="card">
              <h2>Open seat.</h2>
              <p className="hint">
                {state.players[state.current].name} has no player yet. Take this seat{login ? ` as @${login}` : ''} and play its turn?
              </p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn btn-primary" type="button" onClick={() => void claim()} disabled={!login || store.mode !== 'rw'}>
                  Play as {state.players[state.current].name}
                </button>
                <button className="btn btn-ghost" type="button" onClick={onExit}>
                  Back
                </button>
              </div>
              {!login && <p className="hint">Sign in to claim a seat in a shared game.</p>}
            </div>
          </div>
        )}
        {state.winner !== null && (
          <div className="overlay">
            <div className="card">
              <h2>{state.players[state.winner].name} wins.</h2>
              <p className="hint">{state.log[state.log.length - 1]}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn btn-primary" type="button" onClick={onExit}>
                  Back to lobby
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {error && <div className="error" style={{ padding: '4px 12px' }}>{error}</div>}
      <ActionBar
        state={state}
        unit={unit}
        city={city}
        mine={!!mine}
        busy={busy}
        onFound={() => unit && apply((s) => foundCity(s, unit.id))}
        onSkip={() => unit && apply((s) => ({ ...s, units: s.units.map((x) => (x.id === unit.id ? { ...x, moves: 0 } : x)) }))}
        onNext={nextUnit}
        onSetProduction={(item: Production | null) => city && apply((s) => setProduction(s, city.id, item))}
        onBuy={(item: Production) => city && apply((s) => buy(s, city.id, item))}
        onEndTurn={finishTurn}
      />
    </div>
  );
}

export default GameScreen;
