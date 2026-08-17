/**
 * Bus service alerts.
 *
 * Buses earn a panel in an accessibility app for a specific reason: every MTA
 * bus is wheelchair accessible. Each one has a ramp or a lift and kneels at the
 * curb, with no elevator to break. Where the subway is 28% accessible by
 * station, the bus network is effectively 100%.
 *
 * That inverts the usual relationship. For a rider who cannot use a station,
 * the bus is not the fallback — it is often the only reliable option, which
 * makes a bus detour or suspension an accessibility problem rather than a
 * routine service note.
 */
import { useCallback, useEffect, useState } from 'react';

import type { BusAlertResponse } from './api';
import { ApiError, DATA_MODE, fetchBusAlerts } from './api';
import { ErrorNotice, Loading } from './components';
import { useAutoRefresh, useAutoRefreshSetting } from './useAutoRefresh';
import { Switch } from './components';

export function Buses() {
  const [data, setData] = useState<BusAlertResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useAutoRefreshSetting();

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    fetchBusAlerts()
      .then(setData)
      .catch((err) => {
        if (!quiet) setError(err instanceof ApiError ? err.message : 'Could not load bus alerts.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);
  useAutoRefresh(() => load(true), DATA_MODE === 'live' && autoRefresh);

  if (loading) return <Loading label="Loading bus alerts…" />;
  if (error) return <ErrorNotice message={error} onRetry={() => load()} />;
  if (!data) return null;

  const needle = filter.trim().toUpperCase();
  const alerts = needle
    ? data.alerts.filter(
        (a) =>
          a.routes.some((r) => r.toUpperCase().includes(needle)) ||
          a.header.toUpperCase().includes(needle),
      )
    : data.alerts;

  return (
    <section aria-labelledby="bus-heading">
      <h3 id="bus-heading">Buses</h3>

      {/* The reason this panel exists, stated once and prominently. */}
      <div className="notice notice-plain" style={{ marginTop: '1rem' }}>
        <h4>
          <span aria-hidden="true">✓</span> Every MTA bus is wheelchair accessible
        </h4>
        <p>
          All buses have a ramp or lift and kneel at the curb — there is no elevator to be out
          of service. When a station has no accessible route, the bus usually does. Which is why
          a bus detour matters here: it can remove the only accessible option on a corridor.
        </p>
      </div>

      <div className="field" style={{ marginTop: '1.5rem' }}>
        <label htmlFor="bus-filter">Filter by route or text</label>
        <input
          id="bus-filter"
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="e.g. M14A+ or Bx19"
          autoComplete="off"
        />
      </div>

      <div className="refresh-bar" style={{ marginTop: '1rem' }}>
        {DATA_MODE === 'live' ? (
          <Switch
            label="Refresh every 5 minutes"
            hint="Updates the list in place. It never reloads the page or moves your position."
            checked={autoRefresh}
            onChange={setAutoRefresh}
          />
        ) : (
          <p className="snapshot-static">
            MTA bus alerts refreshed when this app opened. Reload the page to request them again.
          </p>
        )}
        <p className="refresh-stamp" role="status">
          {alerts.length} of {data.total} alert{data.total === 1 ? '' : 's'}
        </p>
      </div>

      {alerts.length === 0 ? (
        <div className="notice notice-plain">
          <p>
            {needle
              ? `No bus alerts match “${filter}”.`
              : 'No bus service alerts right now.'}
          </p>
        </div>
      ) : (
        <ul className="outage-list">
          {alerts.map((alert) => (
            <li key={alert.id} className="outage outage-info">
              <span className="outage-top">
                <span className="outage-where">{alert.routes.join(', ')}</span>
                {alert.alert_type ? (
                  <span className="outage-tag">{alert.alert_type.toUpperCase()}</span>
                ) : null}
              </span>
              <span className="outage-impact">{alert.header}</span>
              {alert.description && alert.description !== alert.header ? (
                <span className="outage-reason">{alert.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
