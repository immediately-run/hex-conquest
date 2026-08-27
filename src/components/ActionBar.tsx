import {
  canBuy, canFound, cityYield, productionCost, productionPrice, TERRAIN, terrainAt, UNITS, WALLS,
  type City, type GameState, type Production, type Unit,
} from '../lib/engine';

interface Props {
  state: GameState;
  unit: Unit | null;
  city: City | null;
  mine: boolean;
  busy: boolean;
  onFound: () => void;
  onSkip: () => void;
  onNext: () => void;
  onSetProduction: (item: Production | null) => void;
  onBuy: (item: Production) => void;
  onEndTurn: () => void;
}

const PRODUCTION: Production[] = ['warrior', 'archer', 'settler', 'walls'];
const label = (p: Production): string => (p === 'walls' ? WALLS.label : UNITS[p].label);

function ActionBar({ state, unit, city, mine, busy, onFound, onSkip, onNext, onSetProduction, onBuy, onEndTurn }: Props) {
  const me = state.players[state.current];
  const last = state.log[state.log.length - 1] ?? '';
  const ownCity = city && city.owner === state.current && mine;
  const ownUnit = unit && unit.owner === state.current && mine;

  return (
    <div className="actionbar">
      <div className="main">
        <div className="info">
          {unit ? (
            <>
              <b>
                {UNITS[unit.type].label}
                {unit.owner !== state.current && ` (${state.players[unit.owner]?.name ?? 'neutral'})`}
              </b>
              <div className="sub">
                {unit.hp}/10 hp · {unit.moves}/{UNITS[unit.type].moves} moves · att {UNITS[unit.type].attack} · def {UNITS[unit.type].defence}
                {' · '}
                {TERRAIN[terrainAt(state, unit)].label.toLowerCase()}
                {TERRAIN[terrainAt(state, unit)].defence > 0 && ` +${TERRAIN[terrainAt(state, unit)].defence} def`}
              </div>
            </>
          ) : city ? (
            <>
              <b>
                {city.name}
                {city.owner !== state.current && ` (${state.players[city.owner]?.name ?? 'neutral'})`}
              </b>
              <div className="sub">
                pop {city.pop} · +{cityYield(city).shields} shields · +{cityYield(city).gold} gold{city.walls ? ' · walls' : ''}
                {city.production && ` · ${label(city.production)} ${city.progress}/${productionCost(city.production)}`}
              </div>
            </>
          ) : (
            <>
              <b>{mine ? 'Your turn' : me.name}</b>
              <div className="sub">{mine ? 'Tap a unit to move it, or a city to manage it.' : 'Tap anything to inspect it.'}</div>
            </>
          )}
        </div>

        {ownUnit && (
          <div className="actions">
            {unit.type === 'settler' && (
              <button className="btn btn-primary btn-sm" type="button" disabled={!canFound(state, unit) || busy} onClick={onFound}>
                Found city
              </button>
            )}
            <button className="btn btn-ghost btn-sm" type="button" disabled={busy || unit.moves === 0} onClick={onSkip}>
              Skip
            </button>
          </div>
        )}

        <div className="end">
          <span className="gold" title="Gold">
            ★ {me.gold}
          </span>
          {mine && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={onNext} disabled={busy}>
              Next unit
            </button>
          )}
          <button className="btn btn-primary" type="button" onClick={onEndTurn} disabled={!mine || busy || state.winner !== null}>
            End turn
          </button>
        </div>
      </div>

      {ownCity && (
        <div className="chips" aria-label="City production">
          {PRODUCTION.map((p) => {
            const disabled = p === 'walls' && city.walls;
            return (
              <button
                key={p}
                type="button"
                className={`chip${city.production === p ? ' active' : ''}`}
                disabled={disabled || busy}
                onClick={() => onSetProduction(p)}
                title={p === 'walls' ? WALLS.blurb : UNITS[p].blurb}
              >
                {label(p)}
                <small>{productionCost(p)}</small>
              </button>
            );
          })}
          <span className="hint" style={{ alignSelf: 'center' }}>· buy:</span>
          {PRODUCTION.map((p) => (
            <button
              key={`buy-${p}`}
              type="button"
              className="chip"
              disabled={!canBuy(state, city, p) || busy}
              onClick={() => onBuy(p)}
              title={`Buy ${label(p).toLowerCase()} for ${productionPrice(p)} gold`}
            >
              {label(p)}
              <small>★ {productionPrice(p)}</small>
            </button>
          ))}
        </div>
      )}

      {last && <div className="log">{last}</div>}
    </div>
  );
}

export default ActionBar;
