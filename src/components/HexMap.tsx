import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { hexCenter, hexPoints, key, mapPixelSize, type Hex } from '../lib/hex';
import { canFoundAt, NEUTRAL, MAX_HP, type GameState, type Step, type Unit } from '../lib/engine';

interface Props {
  state: GameState;
  selectedUnit: Unit | null;
  selectedCityId: number | null;
  reach: Map<string, Step>;
  targetIds: Set<number>;
  onTap: (hex: Hex) => void;
}

const SIZE = 30;
const PAD = 10;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;

interface View {
  x: number;
  y: number;
  k: number;
}

const playerColor = (owner: number): string => (owner === NEUTRAL ? 'var(--pn)' : `var(--p${owner})`);

function UnitIcon({ type, cx, cy }: { type: Unit['type']; cx: number; cy: number }) {
  // Tiny Lucide-style strokes: sword, bow, flag.
  if (type === 'warrior') {
    return <path className="icon" d={`M${cx - 5},${cy + 5} L${cx + 4},${cy - 4} M${cx + 2},${cy - 6} L${cx + 6},${cy - 2} M${cx - 3},${cy + 1} L${cx - 1},${cy + 3}`} />;
  }
  if (type === 'archer') {
    return <path className="icon" d={`M${cx - 4},${cy - 6} Q${cx + 6},${cy} ${cx - 4},${cy + 6} M${cx - 4},${cy - 6} L${cx - 4},${cy + 6} M${cx - 4},${cy} L${cx + 5},${cy}`} />;
  }
  return <path className="icon" d={`M${cx - 4},${cy + 7} L${cx - 4},${cy - 7} L${cx + 5},${cy - 4} L${cx - 4},${cy - 1}`} />;
}

function HexMap({ state, selectedUnit, selectedCityId, reach, targetIds, onTap }: Props) {
  const { width, height } = state.settings;
  const px = mapPixelSize(width, height, SIZE);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; start: { x: number; y: number }; t: number; lastDist: number | null; lastMid: { x: number; y: number } | null }>({
    moved: false, start: { x: 0, y: 0 }, t: 0, lastDist: null, lastMid: null,
  });

  // viewBox units per CSS pixel (preserveAspectRatio="xMidYMid meet").
  const unitsPerPx = useCallback((): number => {
    const el = svgRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    return Math.max((px.w + 2 * PAD) / r.width, (px.h + 2 * PAD) / r.height);
  }, [px.w, px.h]);

  const toLocal = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current!;
      const r = el.getBoundingClientRect();
      const u = unitsPerPx();
      // Offset for the letterboxing "meet" adds.
      const ox = (r.width * u - (px.w + 2 * PAD)) / 2;
      const oy = (r.height * u - (px.h + 2 * PAD)) / 2;
      return { x: (clientX - r.left) * u - ox - PAD, y: (clientY - r.top) * u - oy - PAD };
    },
    [unitsPerPx, px.w, px.h],
  );

  const zoomAt = useCallback((factor: number, at: { x: number; y: number }) => {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      const f = k / v.k;
      return { k, x: at.x - (at.x - v.x) * f, y: at.y - (at.y - v.y) * f };
    });
  }, []);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { moved: false, start: { x: e.clientX, y: e.clientY }, t: Date.now(), lastDist: null, lastMid: null };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const prev = { ...p };
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const u = unitsPerPx();
    if (pointers.current.size === 1) {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.moved) setView((v) => ({ ...v, x: v.x + (e.clientX - prev.x) * u, y: v.y + (e.clientY - prev.y) * u }));
    } else if (pointers.current.size === 2) {
      g.moved = true;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (g.lastDist && g.lastMid) {
        const local = toLocal(mid.x, mid.y);
        zoomAt(dist / g.lastDist, local);
        setView((v) => ({ ...v, x: v.x + (mid.x - g.lastMid!.x) * u, y: v.y + (mid.y - g.lastMid!.y) * u }));
      }
      g.lastDist = dist;
      g.lastMid = mid;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      if (!g.moved && Date.now() - g.t < 600) {
        const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
        const tile = el?.closest('[data-q]') as SVGElement | null;
        if (tile) onTap({ q: Number(tile.dataset.q), r: Number(tile.dataset.r) });
      }
      g.lastDist = null;
      g.lastMid = null;
    } else {
      g.lastDist = null;
      g.lastMid = null;
    }
  };

  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, toLocal(e.clientX, e.clientY));
  };

  // Wheel needs a non-passive listener to prevent page scroll inside the host.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const tiles: { hex: Hex; c: { x: number; y: number }; t: GameState['tiles'][number] }[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      tiles.push({ hex: { q, r }, c: hexCenter({ q, r }, SIZE), t: state.tiles[r * width + q] });
    }
  }
  const canFoundHere = selectedUnit?.type === 'settler' && selectedUnit.owner === state.current && canFoundAt(state, selectedUnit);

  return (
    <div className="mapwrap">
      <svg
        ref={svgRef}
        viewBox={`${-PAD} ${-PAD} ${px.w + 2 * PAD} ${px.h + 2 * PAD}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        role="application"
        aria-label="Hex map"
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {tiles.map(({ hex, c, t }) => {
            const k = key(hex);
            const step = reach.get(k);
            return (
              <g key={k}>
                <polygon
                  className={`hex t-${t}${step ? ' reach' : ''}`}
                  points={hexPoints(c.x, c.y, SIZE - 0.6)}
                  data-q={hex.q}
                  data-r={hex.r}
                />
                {t === 'forest' && (
                  <g className="deco forest">
                    <circle cx={c.x - 7} cy={c.y + 4} r={4.5} />
                    <circle cx={c.x + 3} cy={c.y - 6} r={5} />
                    <circle cx={c.x + 8} cy={c.y + 6} r={4} />
                  </g>
                )}
                {t === 'hills' && <path className="deco hills" d={`M${c.x - 12},${c.y + 6} l7,-9 l5,6 l4,-5 l8,8`} />}
                {t === 'water' && <path className="deco water" d={`M${c.x - 10},${c.y - 3} q4,-4 8,0 t8,0 M${c.x - 8},${c.y + 6} q4,-4 8,0 t8,0`} />}
              </g>
            );
          })}

          {/* movement + attack overlays */}
          {[...reach.keys()].map((k) => {
            const [q, r] = k.split(',').map(Number);
            const c = hexCenter({ q, r }, SIZE);
            return <polygon key={`m${k}`} className="ov move" points={hexPoints(c.x, c.y, SIZE - 4)} />;
          })}
          {state.units
            .filter((u) => targetIds.has(u.id))
            .map((u) => {
              const c = hexCenter(u, SIZE);
              return <polygon key={`a${u.id}`} className="ov attack" points={hexPoints(c.x, c.y, SIZE - 3)} />;
            })}

          {/* cities */}
          {state.cities.map((city) => {
            const c = hexCenter(city, SIZE);
            const hasUnit = state.units.some((u) => u.q === city.q && u.r === city.r);
            return (
              <g key={`c${city.id}`} className="city">
                <rect className="base" x={c.x - 13} y={c.y - 11} width={26} height={22} rx={5} fill={playerColor(city.owner)} />
                {city.walls && <rect className="walls" x={c.x - 15.5} y={c.y - 13.5} width={31} height={27} rx={7} />}
                {!hasUnit && (
                  <path
                    className="icon"
                    fill="none"
                    stroke="#fff"
                    strokeWidth={1.6}
                    d={`M${c.x - 7},${c.y + 6} V${c.y - 2} L${c.x},${c.y - 8} L${c.x + 7},${c.y - 2} V${c.y + 6} Z M${c.x - 2},${c.y + 6} V${c.y + 1} H${c.x + 2} V${c.y + 6}`}
                  />
                )}
                <text className="name" x={c.x} y={c.y + SIZE - 6}>{city.name}</text>
                <text className="pop" x={c.x + 9} y={c.y - 13}>{city.pop}</text>
                {selectedCityId === city.id && <polygon className="ov citysel" points={hexPoints(c.x, c.y, SIZE - 2)} />}
              </g>
            );
          })}

          {/* units */}
          {state.units.map((u) => {
            const c = hexCenter(u, SIZE);
            const done = u.owner === state.current && u.moves === 0;
            const hpw = 22 * (u.hp / MAX_HP);
            const hpClass = u.hp <= 3 ? 'crit' : u.hp <= 6 ? 'low' : '';
            return (
              <g key={`u${u.id}`} className={`unit${done ? ' done' : ''}`}>
                <circle className="body" cx={c.x} cy={c.y} r={11} fill={playerColor(u.owner)} />
                <UnitIcon type={u.type} cx={c.x} cy={c.y} />
                <rect className="hpbg" x={c.x - 11} y={c.y + 13} width={22} height={3.5} rx={1.5} />
                <rect className={`hp ${hpClass}`} x={c.x - 11} y={c.y + 13} width={hpw} height={3.5} rx={1.5} />
              </g>
            );
          })}

          {selectedUnit && (
            <polygon
              className={`ov ${canFoundHere ? 'found' : 'sel'}`}
              points={hexPoints(hexCenter(selectedUnit, SIZE).x, hexCenter(selectedUnit, SIZE).y, SIZE - 1.5)}
            />
          )}
          {selectedUnit && canFoundHere && (() => {
            const c = hexCenter(selectedUnit, SIZE);
            return <polygon className="ov sel" points={hexPoints(c.x, c.y, SIZE - 4)} />;
          })()}
        </g>
      </svg>
      <div className="mapzoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.25, { x: px.w / 2, y: px.h / 2 })}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, { x: px.w / 2, y: px.h / 2 })}>−</button>
        <button type="button" aria-label="Reset view" onClick={() => setView({ x: 0, y: 0, k: 1 })}>○</button>
      </div>
      <div className="maphint">drag to pan · pinch or scroll to zoom · {selectedUnit ? 'tap a lit hex to move' : 'tap a unit'}</div>
    </div>
  );
}

export default HexMap;
