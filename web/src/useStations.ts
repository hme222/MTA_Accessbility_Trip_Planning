/**
 * The station list, fetched once and shared.
 *
 * Both the planner and the report form need all 496 stations. The list changes
 * only when the feed is rebuilt, so it is cached at module scope rather than
 * refetched per panel — switching tabs should not cost a round trip.
 */
import { useCallback, useEffect, useState } from 'react';

import type { Station } from './api';
import { ApiError, fetchStations } from './api';

let cached: Station[] | null = null;
let inflight: Promise<Station[]> | null = null;

function load(): Promise<Station[]> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchStations()
      .then((stations) => {
        cached = stations;
        return stations;
      })
      .catch((err) => {
        // Leave nothing behind on failure, so a retry actually retries.
        inflight = null;
        throw err;
      });
  }
  return inflight;
}

export function useStations() {
  const [stations, setStations] = useState<Station[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    let live = true;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (live) setStations(result);
      })
      .catch((err) => {
        if (live) setError(err instanceof ApiError ? err.message : 'Could not load stations.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => run(), [run]);

  const retry = useCallback(() => {
    cached = null;
    inflight = null;
    run();
  }, [run]);

  return { stations, loading, error, retry };
}
