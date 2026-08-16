/**
 * Scheduled future outages.
 *
 * Separate from current outages because it answers a different question. The
 * Elevators view says "can I travel now"; this says "can I travel Thursday" —
 * and planning ahead is the norm for riders who must confirm an accessible
 * route, arrange a companion, or line up a paratransit fallback before setting
 * out.
 *
 * It is also where the data layer's `return_outage_soon` hazard comes from: a
 * return platform that works right now but loses its elevator tonight passes
 * every current-state check while still stranding someone.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PlannedOutage, PlannedOutageResponse } from './api';
import { ApiError, fetchPlannedOutages, formatOutageTime } from './api';
import { ErrorNotice, Loading, Switch } from './components';
import { useAutoRefresh, useAutoRefreshSetting } from './useAutoRefresh';

/** Group by calendar day so a rider can scan for the day they care about. */
function dayOf(value: string): string {
  const parsed = new Date(value.replace(/-/g, '/'));
  if (Number.isNaN(parsed.getTime())) return 'Date not given';
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function Planned() {
  const [data, setData] = useState<PlannedOutageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockingOnly, setBlockingOnly] = useState(false);
  const [filter, setFilter] = useState('');
  const [autoRefresh] = useAutoRefreshSetting();

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    fetchPlannedOutages()
      .then(setData)
      .catch((err) => {
        if (!quiet) {
          setError(err instanceof ApiError ? err.message : 'Could not load planned outages.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);
  useAutoRefresh(() => load(true), autoRefresh);

  const grouped = useMemo(() => {
    if (!data) return [];
    const needle = filter.trim().toLowerCase();

    const rows = data.outages.filter((o) => {
      if (blockingOnly && !o.will_block) return false;
      if (!needle) return true;
      return (
        o.station_names.some((n) => n.toLowerCase().includes(needle)) ||
        o.equipment.toLowerCase().includes(needle)
      );
    });

    const byDay = new Map<string, PlannedOutage[]>();
    for (const row of rows) {
      const key = dayOf(row.starts);
      const list = byDay.get(key);
      if (list) list.push(row);
      else byDay.set(key, [row]);
    }
    return [...byDay.entries()];
  }, [data, blockingOnly, filter]);

  if (loading) return <Loading label="Loading planned outages…" />;
  if (error) return <ErrorNotice message={error} onRetry={() => load()} />;
  if (!data) return null;

  const shown = grouped.reduce((sum, [, rows]) => sum + rows.length, 0);

  return (
    <section aria-labelledby="planned-heading">
      <h2 id="planned-heading">Planned outages</h2>
      <p className="results-count" style={{ marginTop: '0.4rem' }}>
        {data.blocking} of {data.total} scheduled closures will remove an accessible route.
      </p>

      <div className="notice notice-plain" style={{ marginTop: '1rem' }}>
        <p>
          Check the day you are traveling, not just today. An elevator that works this afternoon
          may be out overnight — and if it is the one at the station you come back from, the
          outbound trip will look fine right up until you try to return.
        </p>
      </div>

      <div className="field" style={{ marginTop: '1.5rem' }}>
        <label htmlFor="planned-filter">Filter by station or equipment</label>
        <input
          id="planned-filter"
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="e.g. Union Sq or EL220"
          autoComplete="off"
        />
      </div>

      <div className="refresh-bar" style={{ marginTop: '1rem' }}>
        <Switch
          label="Only closures that remove an accessible route"
          hint="Hides escalators and redundant elevators, which do not change a station's status."
          checked={blockingOnly}
          onChange={setBlockingOnly}
        />
        <p className="refresh-stamp" role="status">
          {shown} shown
        </p>
      </div>

      {shown === 0 ? (
        <div className="notice notice-plain">
          <p>
            {filter || blockingOnly
              ? 'No planned outages match those filters.'
              : 'No scheduled outages published right now.'}
          </p>
        </div>
      ) : (
        grouped.map(([day, rows]) => (
          <section key={day} className="planned-day" aria-label={day}>
            <h3 className="planned-day-head">{day}</h3>
            <ul className="outage-list">
              {rows.map((row, index) => (
                <li
                  key={`${row.equipment}-${row.starts}-${index}`}
                  className={`outage ${row.will_block ? 'outage-blocking' : 'outage-info'}`}
                >
                  <span className="outage-top">
                    <span className="outage-where">
                      {row.station_names.filter(Boolean).join(' / ') || 'Unknown station'}
                    </span>
                    <span className="outage-tag">
                      {row.will_block ? 'REMOVES ACCESS' : 'NO IMPACT'}
                    </span>
                  </span>
                  <span className="outage-meta">
                    {row.type === 'elevator' ? 'Elevator' : 'Escalator'} {row.equipment}
                  </span>
                  {row.serving ? <span className="eq-serving">{row.serving}</span> : null}
                  <span className="outage-impact">
                    {formatOutageTime(row.starts)} → {formatOutageTime(row.ends)}
                  </span>
                  {row.reason ? <span className="outage-reason">Reason: {row.reason}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
