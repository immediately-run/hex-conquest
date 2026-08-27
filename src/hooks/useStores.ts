import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@immediately-run/sdk/auth';
import {
  createSharedStore, openPrivateStore, openRememberedSpace, pickSharedStore, readJson, writeJson, type Store,
} from '../lib/store';
import { seedDemoGame } from '../lib/games';

interface Config {
  spaceId?: string;
  seeded?: boolean;
}

export interface Stores {
  ready: boolean;
  error: string | null;
  priv: Store | null;
  shared: Store | null;
  /** A remembered space that could not be re-mounted (grant not durable / revoked). */
  sharedLost: boolean;
  /** GitHub login of the signed-in user, or '' when unknown. */
  login: string;
  createShared: () => Promise<Store | null>;
  pickShared: () => Promise<Store | null>;
  forgetShared: () => Promise<void>;
}

const configPath = (s: Store) => `${s.root}/config.json`;

/** Opens the private store first (and keeps it), re-mounts a remembered shared
 *  space, and seeds the demo game on first run. StrictMode double-runs the boot
 *  effect: every write is guarded by the `cancelled` flag so only the surviving
 *  run seeds, and seeding itself is idempotent. */
export function useStores(): Stores {
  const auth = useAuth();
  const login = auth.status === 'signed-in' ? (auth.user?.login ?? '') : '';
  const [priv, setPriv] = useState<Store | null>(null);
  const [shared, setShared] = useState<Store | null>(null);
  const [sharedLost, setSharedLost] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef<Config>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await openPrivateStore('data');
        if (cancelled) return;
        const cfg = await readJson<Config>(configPath(p), {});
        if (cancelled) return;
        configRef.current = cfg;
        setPriv(p);
        if (!cfg.seeded) {
          await seedDemoGame(p);
          if (cancelled) return;
          configRef.current = { ...cfg, seeded: true };
          await writeJson(configPath(p), configRef.current);
        }
        if (cfg.spaceId) {
          const s = await openRememberedSpace(cfg.spaceId);
          if (cancelled) return;
          setShared(s);
          setSharedLost(s === null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const remember = useCallback(
    async (s: Store | null) => {
      setShared(s);
      setSharedLost(false);
      if (!priv) return;
      configRef.current = { ...configRef.current, spaceId: s?.spaceId };
      await writeJson(configPath(priv), configRef.current);
    },
    [priv],
  );

  const wrap = useCallback(
    async (open: () => Promise<Store>): Promise<Store | null> => {
      try {
        const s = await open();
        await remember(s);
        return s;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code !== 'cancelled') setError(code ? `Could not open the space (${code}).` : String(e));
        return null;
      }
    },
    [remember],
  );

  return {
    ready,
    error,
    priv,
    shared,
    sharedLost,
    login,
    createShared: () => wrap(() => createSharedStore('Hex Conquest')),
    pickShared: () => wrap(() => pickSharedStore()),
    forgetShared: () => remember(null),
  };
}
