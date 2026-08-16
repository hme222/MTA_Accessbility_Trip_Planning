/**
 * Accessible Transit — root.
 *
 * Three shallow panels. Deep navigation costs a screen reader user real time,
 * so planning, planned outages, and report composition stay in one document.
 *
 * The rule inherited from the data layer holds throughout the UI:
 * **accessibility warns, it never blocks.** Nothing is hidden from a rider.
 * Strict filtering is opt-in, labeled with its consequence, and off by default.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  Outage,
  OutageResponse,
  PlanResponse,
  Severity,
  Station,
  TransferResponse,
} from './api';
import {
  accessSummary,
  ApiError,
  DATA_MODE,
  describeAge,
  fetchHealth,
  fetchOutages,
  fetchPlan,
  fetchTransfers,
  fromInputValues,
  toInputValues,
  todayInNewYork,
} from './api';
import {
  Alternatives,
  EquipmentDetail,
  ErrorNotice,
  Loading,
  ReadAloud,
  StationCombobox,
  Switch,
  TransferCard,
  TripCard,
  spokenPlan,
} from './components';
import { ErrorBoundary } from './ErrorBoundary';
import { Buses } from './Buses';
import { Planned } from './Planned';
import { Report } from './Report';
import { TextSize } from './TextSize';
import { TripMap } from './TripMap';
import { useStations } from './useStations';
import { useAutoRefresh, useAutoRefreshSetting } from './useAutoRefresh';

type Panel = 'plan' | 'planned' | 'report';

export default function App() {
  const [panel, setPanel] = useState<Panel>('plan');

  return (
    <div className="app">
      <a className="sr-only skip-link" href="#main">
        Skip to main content
      </a>

      <Masthead />

      <main id="main" tabIndex={-1}>
        <h1 className="sr-only">Accessible Transit — NYC subway trip planning</h1>

        <Tabs panel={panel} onChange={setPanel} />
        <DataModeNotice />

        {/* Both panels stay mounted so each tab's aria-controls always points
            at an element that exists. Rendering only the active one leaves the
            other tab referencing a missing id. */}
        <div
          role="tabpanel"
          id="panel-plan"
          aria-labelledby="tab-plan"
          tabIndex={-1}
          hidden={panel !== 'plan'}
        >
          <ErrorBoundary>
            <Planner />
          </ErrorBoundary>
        </div>

        <div
          role="tabpanel"
          id="panel-planned"
          aria-labelledby="tab-planned"
          tabIndex={-1}
          hidden={panel !== 'planned'}
        >
          <ErrorBoundary>{panel === 'planned' ? <Planned /> : null}</ErrorBoundary>
        </div>

        <div
          role="tabpanel"
          id="panel-report"
          aria-labelledby="tab-report"
          tabIndex={-1}
          hidden={panel !== 'report'}
        >
          <ErrorBoundary>{panel === 'report' ? <ReportPanel /> : null}</ErrorBoundary>
        </div>
      </main>

      <footer>
        <div>
          {DATA_MODE === 'demo'
            ? 'Demonstration data only — not current MTA service information and not for travel decisions.'
            : "Built on the MTA's public GTFS, Subway Stations, and Elevator & Escalator feeds. Accessibility reflects the feed at build time — outages change hourly."}
        </div>
      </footer>
    </div>
  );
}

// -- chrome ---------------------------------------------------------------

function Masthead() {
  const [dark, setDark] = useState(() =>
    typeof window === 'undefined'
      ? false
      : (localStorage.getItem('theme') ??
          (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark',
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <header className="masthead">
      <div className="masthead-inner">
        <span className="wordmark">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <circle cx="12" cy="4" r="2.2" />
            <path d="M9.4 7.2a1.4 1.4 0 0 1 1.9.6l1.1 2.2h3.2a1.3 1.3 0 0 1 0 2.6h-4a1.4 1.4 0 0 1-1.2-.7l-.3-.6-.7 2.6a5.2 5.2 0 1 0 5.9 6.1h2.6A7.8 7.8 0 1 1 8.6 11l.2-2.6a1.4 1.4 0 0 1 .6-1.2z" />
          </svg>
          Accessible Transit
        </span>
        <TextSize />

        {/* Canonical toggle-button pattern: the name stays fixed and
            aria-pressed carries the state. Changing the label *and* the
            pressed state announces a contradiction ("Light theme, pressed"). */}
        <button
          type="button"
          className="theme-btn"
          aria-pressed={dark}
          onClick={() => setDark((d) => !d)}
        >
          Dark theme
        </button>
      </div>
    </header>
  );
}

const TABS: { key: Panel; label: string }[] = [
  { key: 'plan', label: 'Plan a trip' },
  { key: 'planned', label: 'Planned outages' },
  { key: 'report', label: 'Report a problem' },
];

function DataModeNotice() {
  if (DATA_MODE !== 'demo') return null;

  return (
    <aside className="data-mode" aria-labelledby="data-mode-title">
      <h2 id="data-mode-title">
        <span aria-hidden="true">ⓘ</span> Demonstration snapshot
      </h2>
      <p>
        This static version uses a small representative dataset dated August 16, 2026. It is not
        current MTA service information and must not be used to make travel decisions. Try{' '}
        <strong>Times Sq-42 St to 49 St</strong> to see the return-trip warning.
      </p>
      <a href="../">Read the project notes and data limitations</a>
    </aside>
  );
}

function Tabs({ panel, onChange }: { panel: Panel; onChange: (next: Panel) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  /**
   * Roving tabindex (WAI-ARIA tabs pattern).
   *
   * The selected tab is the only one in the tab order, so an arrow key must
   * move DOM focus as well as selection — otherwise focus stays on a button
   * that just dropped to tabIndex -1 and the next Tab press jumps somewhere
   * unrelated. Home and End are part of the same expected pattern.
   */
  const move = (next: Panel) => {
    onChange(next);
    requestAnimationFrame(() => refs.current[next]?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.key === panel);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(TABS[(index + 1) % TABS.length].key);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(TABS[(index - 1 + TABS.length) % TABS.length].key);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(TABS[0].key);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(TABS[TABS.length - 1].key);
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label="Sections" onKeyDown={onKeyDown}>
      {TABS.map((tab) => {
        const selected = tab.key === panel;
        return (
          <button
            key={tab.key}
            ref={(node) => {
              refs.current[tab.key] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            className="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * How old the accessibility data is.
 *
 * The feed is a snapshot. Implying it is live invites a rider to trust a
 * accessible verdict that stopped being true hours ago — the exact harm this
 * project exists to prevent — so the age is stated rather than hidden.
 */
function Freshness() {
  const [builtAt, setBuiltAt] = useState<number | null>(null);
  const [autoRefresh] = useAutoRefreshSetting();

  const read = useCallback(() => {
    fetchHealth()
      .then((health) => setBuiltAt(health.feed_built_at))
      .catch(() => setBuiltAt(null));
  }, []);

  useEffect(() => read(), [read]);
  // Re-reads the clock, so "updated 4 minutes ago" does not sit frozen while
  // the page stays open.
  useAutoRefresh(read, DATA_MODE === 'live' && autoRefresh);

  if (DATA_MODE === 'demo') return null;

  const age = describeAge(builtAt);
  if (!age) return null;

  return (
    <p className="freshness">
      <span aria-hidden="true">{age.stale ? '⚠' : 'ⓘ'}</span>
      <span>
        Elevator and accessibility data last updated{' '}
        <span className={age.stale ? 'freshness-stale' : undefined}>{age.text}</span>.
        {age.stale ? ' Outages change hourly — rebuild the feed for current status.' : ''}
      </span>
    </p>
  );
}

// -- planner --------------------------------------------------------------

function ReportPanel() {
  const { stations, loading, error, retry } = useStations();
  if (loading) return <Loading label="Loading stations…" />;
  if (error) return <ErrorNotice message={error} onRetry={retry} />;
  return <Report stations={stations} />;
}

function Planner() {
  const { stations, loading: loadingStations, error: stationError, retry: loadStations } =
    useStations();

  const [origin, setOrigin] = useState<Station | undefined>();
  const [destination, setDestination] = useState<Station | undefined>();
  const [stepFreeOnly, setStepFreeOnly] = useState(false);

  // Departure defaults to now, but is editable. Planning ahead is the norm for
  // riders who must confirm an accessible route or arrange a fallback first.
  const [when, setWhen] = useState(() => {
    const now = todayInNewYork();
    return toInputValues(now.date, now.time);
  });

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const resultsRef = useRef<HTMLHeadingElement>(null);
  const requestId = useRef(0);

  // Results belong to a specific pair; a changed selection invalidates them.
  useEffect(() => {
    setPlan(null);
    setSearchError(null);
  }, [origin?.stop_id, destination?.stop_id]);

  const search = async () => {
    if (!origin || !destination) return;
    const id = ++requestId.current;

    setSearching(true);
    setSearchError(null);
    const { date, after } = fromInputValues(when.date, when.time);

    try {
      const result = await fetchPlan(origin.stop_id, destination.stop_id, {
        date,
        after,
        limit: 20,
        requireStepFree: stepFreeOnly,
      });
      if (id !== requestId.current) return; // a newer search superseded this one
      setPlan(result);
      // Send focus to the results heading so a keyboard or screen reader user
      // lands on the answer instead of hunting for it below the form.
      requestAnimationFrame(() => resultsRef.current?.focus());
    } catch (err) {
      if (id !== requestId.current) return;
      setSearchError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  };

  /**
   * Replace one end of the trip with a suggested accessible station.
   *
   * Confirmed out loud, because the field the user is not looking at is the
   * one that changed.
   */
  const swapTo = (which: 'origin' | 'destination', stopId: string) => {
    const next = stations.find((s) => s.stop_id === stopId);
    if (!next) return;
    if (which === 'origin') setOrigin(next);
    else setDestination(next);
    setNotice(
      `${which === 'origin' ? 'Start' : 'Destination'} changed to ${next.stop_name}, which is ${accessSummary(next).toLowerCase()}.`,
    );
  };

  const swap = () => {
    setOrigin(destination);
    setDestination(origin);
    // Both fields change at once with no visual transition to follow; without
    // this a screen reader user gets no confirmation anything happened.
    setNotice(
      destination && origin
        ? `Swapped. From ${destination.stop_name}, to ${origin.stop_name}.`
        : 'Swapped start and destination.',
    );
  };

  if (loadingStations) return <Loading label="Loading stations…" />;
  if (stationError) return <ErrorNotice message={stationError} onRetry={loadStations} />;

  const ready = Boolean(origin && destination);

  return (
    <>
      <Freshness />

      <form
        className="planner"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <h2 className="sr-only">Plan a trip</h2>

        {/* Announcements for changes that have no other spoken signal. */}
        <span className="sr-only" role="status">
          {notice}
        </span>

        <StationCombobox
          label="From"
          stations={stations}
          value={origin}
          exclude={destination?.stop_id}
          onChange={setOrigin}
        />
        {origin ? <EquipmentDetail station={origin} /> : null}
        {origin ? (
          <Alternatives station={origin} role="origin" onSwap={(id) => swapTo('origin', id)} />
        ) : null}

        <StationCombobox
          label="To"
          stations={stations}
          value={destination}
          exclude={origin?.stop_id}
          onChange={setDestination}
        />
        {destination ? <EquipmentDetail station={destination} /> : null}
        {destination ? (
          <Alternatives
            station={destination}
            role="destination"
            onSwap={(id) => swapTo('destination', id)}
          />
        ) : null}

        <div className="when">
          <div className="field">
            <label htmlFor="depart-date">Departure date</label>
            <input
              id="depart-date"
              type="date"
              value={when.date}
              onChange={(event) => setWhen((w) => ({ ...w, date: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="depart-time">Departing after</label>
            <input
              id="depart-time"
              type="time"
              value={when.time}
              onChange={(event) => setWhen((w) => ({ ...w, time: event.target.value }))}
            />
          </div>
        </div>

        {/* Stated before the search, not after an empty result. Discovering a
            limitation through failure is the most expensive way to learn it. */}
        <p className="form-help" id="planner-scope">
          Direct trips appear first. The planner also checks a bounded set of journeys with{' '}
          <strong>one change</strong>; more complex journeys are not included.
        </p>

        <div className="controls">
          <Switch
            label="ADA accessible trips only"
            hint="Hides anything with a warning. If your destination is not ADA accessible, this returns nothing at all."
            checked={stepFreeOnly}
            onChange={setStepFreeOnly}
          />
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={swap} disabled={!ready}>
              Swap
            </button>
            <button
              type="submit"
              className="btn"
              disabled={!ready || searching}
              aria-describedby="planner-scope"
            >
              {searching ? 'Finding trips…' : 'Find trips'}
            </button>
          </div>
        </div>
      </form>

      {origin ? <TripMap origin={origin} destination={destination} /> : null}

      {searchError ? <ErrorNotice message={searchError} onRetry={search} /> : null}
      {searching ? <Loading label="Finding trips…" /> : null}

      {plan && !searching ? (
        <Results plan={plan} stepFreeOnly={stepFreeOnly} headingRef={resultsRef} />
      ) : null}

      {plan && !searching ? (
        <Transfers origin={plan.origin.stop_id} destination={plan.destination.stop_id} when={when} />
      ) : null}

      {/* Elevator and bus status belong with trip planning rather than off in
          their own tabs: they are what a rider checks about the trip they are
          about to take. Collapsed so they do not bury the planner. */}
      <section
        className="subsections"
        aria-label={DATA_MODE === 'demo' ? 'Demonstration service information' : 'Live service information'}
      >
        <details className="subsection">
          <summary><span aria-hidden="true">▸</span> Elevator &amp; escalator outages</summary>
          <div className="subsection-body">
            <ErrorBoundary><Outages /></ErrorBoundary>
          </div>
        </details>

        <details className="subsection">
          <summary><span aria-hidden="true">▸</span> Bus alerts — every MTA bus is accessible</summary>
          <div className="subsection-body">
            <ErrorBoundary><Buses /></ErrorBoundary>
          </div>
        </details>
      </section>
    </>
  );
}

/**
 * Journeys with one change of train.
 *
 * Fetched separately from the direct results because it costs seconds rather
 * than milliseconds. It matters disproportionately here: with only 140 of 496
 * stations fully accessible, many usable journeys require a change — and a
 * change is exactly where accessibility breaks, needing four working platforms
 * instead of two.
 */
function Transfers({
  origin,
  destination,
  when,
}: {
  origin: string;
  destination: string;
  when: { date: string; time: string };
}) {
  const [data, setData] = useState<TransferResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    const { date, after } = fromInputValues(when.date, when.time);
    fetchTransfers(origin, destination, { date, after, limit: 2 }, controller.signal)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [origin, destination, when.date, when.time]);

  if (loading) return <Loading label="Looking for journeys with one change…" />;
  if (!data || data.count === 0) return null;

  return (
    <section className="results" aria-labelledby="transfers-heading">
      <div className="results-head">
        <h2 id="transfers-heading">
          {data.count} journey{data.count === 1 ? '' : 's'} with one change
        </h2>
      </div>
      <ul className="trip-list">
        {data.options.map((option) => (
          <TransferCard
            key={`${option.leg_1.route}-${option.leg_2.route}-${option.transfer_station}-${option.depart}`}
            option={option}
          />
        ))}
      </ul>
    </section>
  );
}

function Results({
  plan,
  stepFreeOnly,
  headingRef,
}: {
  plan: PlanResponse;
  stepFreeOnly: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const counts = plan.severity_counts;
  const trapped = counts.return_warning > 0 && counts.step_free === 0;

  return (
    <section className="results" aria-labelledby="results-heading">
      <div className="results-head">
        <h2 id="results-heading" ref={headingRef} tabIndex={-1}>
          {plan.count === 0
            ? 'No trips found'
            : `${plan.count} trip${plan.count === 1 ? '' : 's'} to ${plan.destination.stop_name}`}
        </h2>
        {plan.count > 0 ? <p className="results-count">{summarize(counts)}</p> : null}
        {plan.count > 0 ? (
          <ReadAloud
            text={spokenPlan(
              plan.destination.stop_name,
              plan.count,
              summarize(counts),
              plan.trips,
            )}
          />
        ) : null}
      </div>

      {/* The headline finding this project exists to surface: you can get
          there, but you cannot get back the same way. */}
      {trapped ? (
        <div className="notice notice-warn">
          <h3>
            <span aria-hidden="true">↺</span> One-way trip
          </h3>
          <p>
            You can reach {plan.destination.stop_name} by an accessible route, but the platform you would come
            back from is not accessible.
          </p>
        </div>
      ) : null}

      <TripMap origin={plan.origin} destination={plan.destination} />

      {plan.count === 0 ? (
        <div className="notice notice-plain">
          {stepFreeOnly ? (
            <p>
              Nothing is fully ADA accessible on this route at that time. Turning off{' '}
              <strong>ADA accessible trips only</strong> will show the options that exist, along with
              what to watch out for.
            </p>
          ) : (
            <p>
              No direct service between these stations at that time. One-change options, when
              available, appear below.
            </p>
          )}
        </div>
      ) : (
        <ul className="trip-list">
          {plan.trips.map((trip) => (
            <TripCard key={trip.trip_id} trip={trip} destination={plan.destination.stop_name} />
          ))}
        </ul>
      )}
    </section>
  );
}

function summarize(counts: Record<Severity, number>): string {
  const parts: string[] = [];
  if (counts.step_free) parts.push(`${counts.step_free} fully ADA accessible`);
  if (counts.return_warning) parts.push(`${counts.return_warning} with a return-trip warning`);
  if (counts.outbound_warning) parts.push(`${counts.outbound_warning} not accessible`);
  return parts.join(' · ');
}

// -- outages --------------------------------------------------------------

function Outages() {
  const [data, setData] = useState<OutageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useAutoRefreshSetting();

  const load = useCallback((quiet = false) => {
    // A background refresh must not replace the list with a spinner; the user
    // may be reading it.
    if (!quiet) setLoading(true);
    setError(null);
    fetchOutages()
      .then((result) => {
        setData(result);
        setRefreshedAt(new Date());
      })
      .catch((err) => {
        if (!quiet) setError(err instanceof ApiError ? err.message : 'Could not load outages.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);
  useAutoRefresh(() => load(true), DATA_MODE === 'live' && autoRefresh);

  if (loading) return <Loading label="Loading elevator outages…" />;
  if (error) return <ErrorNotice message={error} onRetry={() => load()} />;
  if (!data) return null;

  return (
    <section aria-labelledby="outages-heading">
      <div className="outage-head">
        <h3 id="outages-heading">Equipment outages</h3>
        <p className="results-count">
          {data.blocking} of {data.total} remove the accessible route
        </p>
        {DATA_MODE === 'live' ? (
          <button type="button" className="btn btn-secondary" onClick={() => load()}>
            Refresh now
          </button>
        ) : null}
      </div>

      {DATA_MODE === 'live' ? (
        <div className="refresh-bar">
          <Switch
            label="Refresh every 5 minutes"
            hint="Updates the list in place. It never reloads the page or moves your position."
            checked={autoRefresh}
            onChange={setAutoRefresh}
          />
          {/* Polite: useful to know, never worth interrupting for. */}
          <p className="refresh-stamp" role="status">
            {refreshedAt
              ? `Updated ${refreshedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
              : ''}
          </p>
        </div>
      ) : (
        <p className="snapshot-static">Snapshot outage records do not refresh.</p>
      )}

      {data.outages.length === 0 ? (
        <div className="notice notice-plain">
          <p>No outages reported. Every tracked elevator and escalator is in service.</p>
        </div>
      ) : (
        <ul className="outage-list">
          {data.outages.map((outage) => (
            <OutageRow key={outage.equipment} outage={outage} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OutageRow({ outage }: { outage: Outage }) {
  const where = outage.station_names.filter(Boolean).join(' / ') || 'Unknown station';

  // Why it does or does not count as blocking, in the rider's terms. Mirrors
  // the backend rule exactly so the two never drift.
  const impact = outage.blocking
    ? 'Removes the accessible route at this station'
    : outage.type === 'escalator'
      ? 'Escalator — not part of an accessible route, so accessibility is unchanged'
      : outage.redundant
        ? 'Another elevator covers the same accessible route'
        : 'Does not affect the accessible route';

  return (
    <li className={`outage ${outage.blocking ? 'outage-blocking' : 'outage-info'}`}>
      <span className="outage-top">
        <span className="outage-where">{where}</span>
        <span className="outage-tag">{outage.blocking ? 'BLOCKING' : 'INFO'}</span>
      </span>
      <span className="outage-meta">
        {outage.type === 'elevator' ? 'Elevator' : 'Escalator'} {outage.equipment}
        {outage.serving ? ` · ${outage.serving}` : ''}
      </span>
      <span className="outage-impact">{impact}</span>
      {outage.reason ? <span className="outage-reason">Reason: {outage.reason}</span> : null}
      {outage.estimated_return ? (
        <span className="outage-reason">Estimated return: {outage.estimated_return}</span>
      ) : null}
    </li>
  );
}
