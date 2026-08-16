/**
 * Shared presentation pieces.
 *
 * A recurring pattern here: the visual composition and the spoken description
 * are built separately. A row of route bullets reads well to the eye and
 * terribly to a screen reader ("N Q R W" as four unlabeled letters), so the
 * decorative parts are hidden with aria-hidden and one written label describes
 * the whole.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { speak, speechSupported, stop as stopSpeech } from './speech';

import type {
  Alternative,
  Equipment,
  Ramp,
  RampReport,
  StationEquipment,
  Severity,
  Station,
  TransferOption,
  TripOption,
} from './api';
import {
  accessLevel,
  accessSummary,
  describeDistance,
  durationMinutes,
  fetchAlternatives,
  fetchAllEquipment,
  fetchRamps,
  fetchEquipment,
  formatOutageTime,
  formatTime,
  severityGlyph,
  severityLabel,
  severitySpoken,
  spokenServices,
  spokenRoutes,
  spokenTime,
  stopKindLabel,
} from './api';

// -- route bullets --------------------------------------------------------

/**
 * MTA line colors, exactly as the agency publishes them — the hue is the
 * recognition cue a rider actually uses, so it is not adjusted.
 *
 * The letter color is chosen per line to clear WCAG AA (4.5:1) against that
 * hue. The MTA sets white on every bullet, but white fails on five of them
 * (orange 2.98:1, G 2.31:1, red 4.05:1, green 4.01:1, S 3.90:1). Dark text
 * passes on all five without touching the brand color; darkening the hues
 * enough to rescue white text would have cost orange 21% and the G 31% of
 * their luminance, which is visible as a different color.
 */
const ROUTE_COLORS: Record<string, string> = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
  '4': '#00933C', '5': '#00933C', '6': '#00933C',
  '7': '#B933AD',
  A: '#0039A6', C: '#0039A6', E: '#0039A6',
  B: '#FF6319', D: '#FF6319', F: '#FF6319', M: '#FF6319',
  G: '#6CBE45',
  J: '#996633', Z: '#996633',
  L: '#A7A9AC',
  N: '#FCCC0A', Q: '#FCCC0A', R: '#FCCC0A', W: '#FCCC0A',
  S: '#808183', SI: '#0039A6', SIR: '#0039A6',
};

/** Lines whose hue is light enough to need dark text. See note above. */
const DARK_TEXT = new Set([
  '1', '2', '3', '4', '5', '6',
  'B', 'D', 'F', 'M',
  'G', 'L', 'S',
  'N', 'Q', 'R', 'W',
]);

export function RouteBullets({ routes, large }: { routes: string[]; large?: boolean }) {
  if (!routes.length) return null;
  return (
    <span className="bullets" aria-hidden="true">
      {routes.map((route) => {
        const key = route.toUpperCase();
        const busRoute = /^(M|BX|B|Q|S)\d/i.test(key) || key.includes('+');
        return (
          <span
            key={route}
            className={`${large ? 'bullet bullet-lg' : 'bullet'}${busRoute ? ' bullet-bus' : ''}`}
            style={{
              background: ROUTE_COLORS[key] ?? '#4A5058',
              color: DARK_TEXT.has(key) ? '#111417' : '#FFFFFF',
            }}
          >
            {route}
          </span>
        );
      })}
    </span>
  );
}

// -- accessibility verdict ------------------------------------------------

const ACCESS_GLYPH = { full: '✓', partial: '↺', none: '✕' } as const;

export function AccessLine({ station }: { station: Station }) {
  const level = accessLevel(station);
  return (
    <span className={`access access-${level}`} aria-hidden="true">
      <span>{ACCESS_GLYPH[level]}</span>
      {accessSummary(station)}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`chip chip-${severity}`} aria-hidden="true">
      <span>{severityGlyph[severity]}</span>
      {severityLabel[severity]}
    </span>
  );
}

// -- station combobox -----------------------------------------------------

/**
 * Station picker following the ARIA combobox pattern.
 *
 * Every station is listed, including those with no accessible route at all.
 * Hiding them would answer a question the rider did not ask — they may be
 * traveling with someone, or willing to take the stairs at one end — so the
 * list labels status rather than filtering on it.
 */
export function StationCombobox({
  label,
  stations,
  value,
  exclude,
  onChange,
}: {
  label: string;
  stations: Station[];
  value?: Station;
  exclude?: string;
  onChange: (station: Station | undefined) => void;
}) {
  const inputId = useId();
  const listId = useId();
  const labelId = useId();

  // `text` is what the field displays, and it survives focus. Blanking a filled
  // field on focus reads as data loss, which is exactly the wrong signal to send
  // someone who has just carefully found their station.
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the field in step when the selection changes from outside (Swap).
  useEffect(() => {
    setText(value?.stop_name ?? '');
  }, [value?.stop_id]);

  const matches = useMemo(() => {
    const pool = exclude ? stations.filter((s) => s.stop_id !== exclude) : stations;
    const needle = text.trim().toLowerCase();
    // An untouched selection shows the whole list rather than just itself, so
    // reopening the field is a way to browse, not a dead end.
    if (!needle || needle === value?.stop_name.toLowerCase()) return pool.slice(0, 60);
    return pool
      .filter(
        (s) =>
          s.stop_name.toLowerCase().includes(needle) ||
          s.routes.some((route) => route.toLowerCase().includes(needle)),
      )
      .slice(0, 60);
  }, [stations, text, exclude, value?.stop_name]);

  // Announce the result count only once typing pauses. Updating a live region
  // on every keystroke produces a torrent of interruptions that makes the
  // field effectively unusable with a screen reader.
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    if (!open) {
      setAnnounced('');
      return;
    }
    const timer = setTimeout(() => {
      setAnnounced(`${matches.length} location${matches.length === 1 ? '' : 's'} available`);
    }, 500);
    return () => clearTimeout(timer);
  }, [matches.length, open]);

  // Close when focus or a click leaves the widget entirely.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Keep the active option in view during keyboard navigation.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const commit = (station: Station) => {
    onChange(station);
    setText(station.stop_name);
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (matches.length ? (i + delta + matches.length) % matches.length : 0));
      return;
    }
    if (event.key === 'Home' && open) {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === 'End' && open) {
      event.preventDefault();
      setActive(Math.max(0, matches.length - 1));
      return;
    }
    if (event.key === 'Enter' && open && matches[active]) {
      event.preventDefault();
      commit(matches[active]);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') setOpen(false);
  };

  const activeId = open && matches[active] ? `${listId}-${matches[active].stop_id}` : undefined;

  return (
    <div className="field" ref={wrapRef}>
      <label id={labelId} htmlFor={inputId}>
        {label}
      </label>

      <input
        id={inputId}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={value ? `${inputId}-status` : undefined}
        autoComplete="off"
        placeholder="Type a subway station or bus stop"
        value={text}
        onFocus={() => {
          setOpen(true);
          // Select the existing text so typing replaces it, the behavior
          // people expect from a field that is already filled in.
          if (value) inputRef.current?.select();
        }}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange(undefined);
        }}
        onKeyDown={onKeyDown}
      />

      {/* The selected station's accessibility, as words, tied to the input. */}
      {value ? (
        <p id={`${inputId}-status`} className="option-meta">
          <RouteBullets routes={value.routes} />
          <span className="stop-kind">{stopKindLabel(value)}</span>
          <AccessLine station={value} />
          <span className="sr-only">
            {spokenServices(value)}. {accessSummary(value)}.
          </span>
        </p>
      ) : null}

      <span className="sr-only" role="status">
        {announced}
      </span>

      {open ? (
        <ul className="listbox" id={listId} role="listbox" aria-labelledby={labelId} ref={listRef}>
          {matches.length === 0 ? (
            <li className="no-options">No subway stations or bus stops match that search.</li>
          ) : (
            matches.map((station, index) => (
              <li
                key={station.stop_id}
                id={`${listId}-${station.stop_id}`}
                role="option"
                aria-selected={index === active}
                className="option"
                onMouseEnter={() => setActive(index)}
                // mousedown fires before the input's blur, so the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(station);
                }}
              >
                <span className="option-name">{station.stop_name}</span>
                <span className="option-meta">
                  <RouteBullets routes={station.routes} />
                  <span className="stop-kind">{stopKindLabel(station)}</span>
                  <AccessLine station={station} />
                </span>
                <span className="sr-only">
                  {spokenServices(station)}. {accessSummary(station)}.
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Why a station is not accessible right now.
 *
 * The station's own reason field names equipment — "ADA elevator(s) out of
 * service: EL218, EL220" — which is precise and tells a rider nothing. This is
 * what those numbers mean: what each unit serves, why it is out, and when it is
 * due back. Those details decide the trip. An elevator returning within the
 * hour is worth waiting for; one out until Thursday is not.
 *
 * Escalators are listed too, marked as not affecting accessibility, because a
 * rider who can manage stairs but not a long climb still wants to know.
 */
export function EquipmentDetail({ station }: { station: Station }) {
  const [items, setItems] = useState<Equipment[]>([]);
  const level = accessLevel(station);

  useEffect(() => {
    if (level === 'full') {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    fetchEquipment(station.stop_id, controller.signal)
      .then(setItems)
      .catch(() => setItems([]));
    return () => controller.abort();
  }, [station.stop_id, level]);

  if (level === 'full' || items.length === 0) return null;

  const blocking = items.filter((i) => i.blocking);
  const other = items.filter((i) => !i.blocking);

  return (
    <details className="equipment">
      <summary>
        <span aria-hidden="true">▸</span>
        Why {station.stop_name} is not accessible right now
        <span className="equipment-count">
          {blocking.length} blocking
          {other.length ? `, ${other.length} other` : ''}
        </span>
      </summary>

      <ul className="equipment-list">
        {[...blocking, ...other].map((item) => (
          <li key={item.equipment} className={item.blocking ? 'eq eq-blocking' : 'eq eq-info'}>
            <span className="eq-top">
              <strong>{item.type === 'elevator' ? 'Elevator' : 'Escalator'} {item.equipment}</strong>
              <span className="eq-tag">{item.blocking ? 'BLOCKING' : 'NOT BLOCKING'}</span>
            </span>
            {item.serving ? <span className="eq-serving">{item.serving}</span> : null}
            <span className="eq-meta">
              {item.reason ? <>Reason: {item.reason}. </> : null}
              {item.estimated_return ? (
                <>Expected back <strong>{formatOutageTime(item.estimated_return)}</strong>.</>
              ) : (
                <>No return time given.</>
              )}
            </span>
            {!item.blocking ? (
              <span className="eq-why">
                {item.type === 'escalator'
                  ? 'An escalator is not an accessible route, so this does not change the station\u2019s status.'
                  : 'Another elevator covers the same accessible route.'}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

// -- accessible alternatives ---------------------------------------------

/**
 * Nearby accessible stations, offered when the chosen one is not.
 *
 * Warning a rider that their station does not work is only half an answer.
 * This is the other half, and it is a suggestion rather than a substitution —
 * the rider decides, and their original choice stays selected until they say
 * otherwise.
 */
export function Alternatives({
  station,
  role,
  onSwap,
}: {
  station: Station;
  role: 'origin' | 'destination';
  /** Receives the chosen stop_id; the caller resolves it against its own list. */
  onSwap: (stopId: string) => void;
}) {
  const [items, setItems] = useState<Alternative[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const headingId = useId();

  const level = accessLevel(station);

  useEffect(() => {
    if (level === 'full') {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    setState('loading');
    // For a partially accessible station, look for somewhere usable in the
    // direction this one is missing.
    const direction = level === 'partial' ? (station.northbound ? 'S' : 'N') : undefined;
    fetchAlternatives(station.stop_id, { direction, limit: 3 }, controller.signal)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setState('done'));
    return () => controller.abort();
  }, [station.stop_id, level, station.northbound]);

  if (level === 'full' || state === 'loading' || items.length === 0) return null;

  const problem =
    level === 'none'
      ? `${station.stop_name} is not ADA accessible.`
      : `${station.stop_name} is only accessible ${station.northbound ? 'uptown' : 'downtown'}.`;

  return (
    <section className="alternatives" aria-labelledby={headingId}>
      <h3 id={headingId} className="alternatives-head">
        <span aria-hidden="true">↦</span> {problem} Nearby accessible{' '}
        {role === 'origin' ? 'starting points' : 'destinations'}:
      </h3>

      <ul className="alt-list">
        {items.map((alt) => {
          const shared = alt.shared_routes.length
            ? `Same ${alt.shared_routes.join(', ')} ${alt.shared_routes.length === 1 ? 'line' : 'lines'}`
            : 'Different lines';

          return (
            <li key={alt.stop_id}>
              <button
                type="button"
                className="alt"
                onClick={() => onSwap(alt.stop_id)}
                // One sentence covering everything the row shows, plus what
                // pressing it will do.
                aria-label={`Use ${alt.stop_name} instead. ${describeDistance(alt.meters)}, straight line. ${shared}. ${spokenRoutes(alt.routes)}.`}
              >
                <span className="alt-name">{alt.stop_name}</span>
                <span className="alt-meta">
                  <RouteBullets routes={alt.routes} />
                  <span aria-hidden="true">
                    {describeDistance(alt.meters)} · {shared}
                  </span>
                </span>
                <span className="alt-action" aria-hidden="true">
                  Use this
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="alt-note">
        Distances are straight-line, so the walk is longer. Your choice is unchanged until
        you pick one.
      </p>

    </section>
  );
}

/**
 * Curb ramp quality on the walk to a suggested station.
 *
 * Telling a rider to walk 700 m to an accessible station is only useful if the
 * corners in between have curb cuts. NYC DOT publishes every pedestrian ramp
 * with the measurements the ADA specifies, so this scores the walk against the
 * real standard instead of assuming it works.
 *
 * A ramp that misses a threshold is shown as substandard rather than absent —
 * it exists, and some riders manage it. The same "warn, never block" posture
 * the rest of the app takes. What it must not do is imply the walk is fine
 * when the measurements say otherwise.
 */
export function RampQuality({ stopId, stationName }: { stopId: string; stationName: string }) {
  const [report, setReport] = useState<RampReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setReport(null);
    setLoaded(false);
    setOpen(false);
  }, [stopId]);

  useEffect(() => {
    if (!open || loaded) return;
    const controller = new AbortController();
    fetchRamps(stopId, 200, controller.signal)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, [open, loaded, stopId]);

  const share =
    report && report.total > 0 ? Math.round((report.compliant / report.total) * 100) : null;

  return (
    <details
      className="ramps"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span aria-hidden="true">▸</span>
        Curb ramps near {stationName}
        {loaded && report ? (
          <span className="equipment-count">
            {report.compliant} of {report.total} meet ADA
          </span>
        ) : null}
      </summary>

      <div className="ramps-body">
        {!loaded ? (
          <p className="eq-meta">Loading…</p>
        ) : !report || report.error ? (
          <p className="eq-meta">Curb ramp data is unavailable right now.</p>
        ) : report.total === 0 ? (
          <p className="eq-meta">No pedestrian ramps published within 200 m of this station.</p>
        ) : (
          <>
            {/* The headline number, stated plainly — this is the finding. */}
            <p className={share !== null && share < 50 ? 'ramp-head ramp-head-bad' : 'ramp-head'}>
              <strong>
                {report.compliant} of {report.total} nearby ramps
              </strong>{' '}
              meet the ADA standard
              {report.substandard > 0 ? <> · {report.substandard} fall short</> : null}
              {report.unverified > 0 ? <> · {report.unverified} unmeasured</> : null}.
            </p>

            <ul className="ramp-list">
              {report.ramps.slice(0, 6).map((ramp) => (
                <RampRow key={ramp.ramp_id} ramp={ramp} />
              ))}
            </ul>

            <p className="eq-why">
              Scored against the ADA Standards for Accessible Design: running slope at most
              8.33%, cross slope at most 2.08%, clear width at least 36 inches, and a detectable
              warning surface. This is infrastructure data, not a report of current sidewalk
              conditions. Ramps that fall short are listed, not hidden. Source: NYC Open Data.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

function RampRow({ ramp }: { ramp: Ramp }) {
  const status = !ramp.measured ? 'NOT MEASURED' : ramp.compliant ? 'MEETS ADA' : 'BELOW STANDARD';
  return (
    <li className={ramp.compliant ? 'ramp ramp-ok' : ramp.measured ? 'ramp ramp-bad' : 'ramp'}>
      <span className="ramp-top">
        <strong>{ramp.street || `Ramp ${ramp.ramp_id}`}</strong>
        <span className="ramp-tag">{status}</span>
      </span>
      <dl className="ramp-measures">
        <div><dt>Running slope</dt><dd>{ramp.running_slope !== null ? `${ramp.running_slope}%` : 'Not measured'}</dd></div>
        <div><dt>Cross slope</dt><dd>{ramp.cross_slope !== null ? `${ramp.cross_slope}%` : 'Not measured'}</dd></div>
        <div><dt>Clear width</dt><dd>{ramp.width_inches !== null ? `${Math.round(ramp.width_inches)} in` : 'Not measured'}</dd></div>
        <div><dt>Warning surface</dt><dd>{ramp.detectable_warning ?? 'Not published'}</dd></div>
        <div><dt>Surface</dt><dd>{ramp.surface_condition ?? 'Not published'}</dd></div>
        <div><dt>Obstruction</dt><dd>{ramp.obstruction ?? 'None reported'}</dd></div>
        <div><dt>Water ponding</dt><dd>{ramp.ponding === null ? 'Not published' : ramp.ponding ? 'Reported' : 'Not reported'}</dd></div>
      </dl>
      {ramp.issues.length > 0 ? (
        <ul className="ramp-issues">
          {ramp.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// -- switch ---------------------------------------------------------------

export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="switch" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="track" aria-hidden="true">
        <span className="thumb" />
      </span>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint ? (
          <span className="switch-hint" id={`${id}-hint`}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

// -- trip card ------------------------------------------------------------

export function TripCard({ trip, destination }: { trip: TripOption; destination: string }) {
  const minutes = durationMinutes(trip.depart, trip.arrive);

  const spoken = [
    `${trip.route_id} ${trip.mode === 'bus' ? 'bus' : 'train'} to ${trip.trip_headsign}`,
    `departs ${spokenTime(trip.depart)}, arrives ${destination} ${spokenTime(trip.arrive)}`,
    `${minutes} minute${minutes === 1 ? '' : 's'}`,
    severitySpoken[trip.severity],
    ...trip.advisories,
  ].join('. ');

  return (
    <li className={`trip trip-${trip.severity}`}>
      <span className="sr-only">{spoken}</span>

      <div className="trip-top" aria-hidden="true">
        <RouteBullets routes={[trip.route_id]} large />
        <span className="trip-times">
          {formatTime(trip.depart)}
          <span className="trip-arrow">→</span>
          {formatTime(trip.arrive)}
        </span>
        <span className="trip-dur">{minutes} min</span>
      </div>

      <p className="trip-head" aria-hidden="true">
        {trip.mode === 'bus' ? 'bus' : 'train'} to {trip.trip_headsign}
      </p>

      <SeverityChip severity={trip.severity} />

      {trip.advisories.length > 0 ? (
        <ul className="advisories" aria-hidden="true">
          {trip.advisories.map((advisory) => (
            <li key={advisory}>{capitalize(advisory)}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// -- transfer journeys ----------------------------------------------------

/**
 * A two-leg journey.
 *
 * A change of train needs four working platforms instead of two — board,
 * alight, board again, alight — so the transfer point is given as much
 * prominence as the endpoints. It is the most likely thing to break, and the
 * thing a rider is least able to discover in advance.
 */
export function TransferCard({ option }: { option: TransferOption }) {
  const spoken = [
    `${option.leg_1.route} ${option.leg_1.mode === 'bus' ? 'bus' : 'train'} toward ${option.leg_1.headsign}, departing ${spokenTime(option.depart)}`,
    option.walk_between
      ? `arrive ${option.arrive_name}, then walk to ${option.transfer_name}, waiting ${option.wait_minutes} minute${option.wait_minutes === 1 ? '' : 's'}`
      : `change at ${option.transfer_name}, waiting ${option.wait_minutes} minute${option.wait_minutes === 1 ? '' : 's'}`,
    `then the ${option.leg_2.route} ${option.leg_2.mode === 'bus' ? 'bus' : 'train'} toward ${option.leg_2.headsign}, arriving ${spokenTime(option.arrive)}`,
    `${option.total_minutes} minutes total`,
    severitySpoken[option.severity],
    ...option.advisories,
  ].join('. ');

  return (
    <li className={`trip trip-${option.severity}`}>
      <span className="sr-only">{spoken}</span>

      <div className="trip-top" aria-hidden="true">
        <span className="trip-times">
          {formatTime(option.depart)}
          <span className="trip-arrow">→</span>
          {formatTime(option.arrive)}
        </span>
        <span className="trip-dur">
          {option.total_minutes} min · 1 change
        </span>
      </div>

      {/* Each leg is one line end to end; the change row names the station
          where leg two boards and the lines available there, so the itinerary
          is verifiable on its face rather than taken on trust. */}
      <ol className="legs" aria-hidden="true">
        <li>
          <RouteBullets routes={[option.leg_1.route]} />
          <span className="leg-text">
            to {option.leg_1.headsign}
            <span className="leg-time">
              {' · '}arrive {option.arrive_name} at {formatTime(option.leg_1.arrive)}
            </span>
          </span>
        </li>

        <li className="leg-change">
          <span className="leg-change-icon">⇄</span>
          <span className="leg-text">
            {option.walk_between ? (
              <>
                Walk from <strong>{option.arrive_name}</strong> to{' '}
                <strong>{option.transfer_name}</strong>
              </>
            ) : (
              <>
                Change at <strong>{option.transfer_name}</strong>
              </>
            )}
            <span className="leg-time">
              {' · '}
              {option.wait_minutes} min wait
            </span>
            {option.transfer_routes.length ? (
              <span className="leg-lines">
                <span className="leg-lines-label">Lines here:</span>
                <RouteBullets routes={option.transfer_routes} />
              </span>
            ) : null}
          </span>
        </li>

        <li>
          <RouteBullets routes={[option.leg_2.route]} />
          <span className="leg-text">
            to {option.leg_2.headsign}
            <span className="leg-time">
              {' · '}departs {formatTime(option.leg_2.depart)}
            </span>
          </span>
        </li>
      </ol>

      <SeverityChip severity={option.severity} />

      {option.advisories.length > 0 ? (
        <ul className="advisories" aria-hidden="true">
          {option.advisories.map((advisory) => (
            <li key={advisory}>{capitalize(advisory)}</li>
          ))}
        </ul>
      ) : null}

      <TransferEquipment stopId={option.transfer_station} stationName={option.transfer_name} />
    </li>
  );
}

/**
 * Elevators and escalators at a transfer point.
 *
 * A change of train depends on getting between platforms inside the station,
 * and the feed describes exactly that — "mezzanine to lower mezzanine A/C/E to
 * downtown 1/2/3 platform" is the connection a transfer rides on.
 *
 * The text is prose, not structure, so it is shown rather than interpreted.
 * Parsing a route out of it to declare a specific platform-to-platform path
 * step-free would be a guess presented as a fact, which is the one thing this
 * project does not do. The rider reads what is there and decides.
 */
export function TransferEquipment({
  stopId,
  stationName,
}: {
  stopId: string;
  stationName: string;
}) {
  const [items, setItems] = useState<StationEquipment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    const controller = new AbortController();
    fetchAllEquipment(stopId, controller.signal)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, [open, loaded, stopId]);

  const broken = items.filter((i) => !i.working);
  const elevators = items.filter((i) => i.type === 'elevator');

  return (
    <details
      className="transfer-equipment"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span aria-hidden="true">▸</span>
        Elevators &amp; escalators at {stationName}
        {loaded ? (
          <span className="equipment-count">
            {elevators.length} elevator{elevators.length === 1 ? '' : 's'}
            {broken.length ? `, ${broken.length} out of service` : ', all working'}
          </span>
        ) : null}
      </summary>

      <div className="transfer-equipment-body">
        {!loaded ? (
          <p className="eq-meta">Loading…</p>
        ) : items.length === 0 ? (
          <p className="eq-meta">No elevator or escalator data published for this station.</p>
        ) : (
          <>
            <ul className="equipment-list">
              {items.map((item) => (
                <li
                  key={item.equipment}
                  className={item.working ? 'eq eq-ok' : 'eq eq-blocking'}
                >
                  <span className="eq-top">
                    <strong>
                      {item.type === 'elevator' ? 'Elevator' : 'Escalator'} {item.equipment}
                    </strong>
                    <span className="eq-tag">
                      {item.working ? 'WORKING' : 'OUT OF SERVICE'}
                    </span>
                  </span>
                  {item.serving ? <span className="eq-serving">{item.serving}</span> : null}
                  {!item.working ? (
                    <span className="eq-meta">
                      {item.reason ? <>{item.reason}. </> : null}
                      {item.estimated_return ? (
                        <>Expected back <strong>{formatOutageTime(item.estimated_return)}</strong>.</>
                      ) : (
                        <>No return time given.</>
                      )}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="eq-why">
              The MTA describes what each unit connects, but not which platform-to-platform
              route is step-free. Read the descriptions against the change you need to make.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

// -- read aloud -----------------------------------------------------------

/**
 * Speaks a block of text on demand.
 *
 * The button is the whole interface: press to start, press again to stop. It
 * renders nothing at all where the browser has no speech synthesis, rather than
 * offering a control that would do nothing.
 */
export function ReadAloud({ text, label = 'Read results aloud' }: { text: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false);

  // Speech outlives the component unless it is explicitly cancelled, so a
  // navigation away would otherwise keep talking.
  useEffect(() => () => stopSpeech(), []);

  if (!speechSupported()) return null;

  const toggle = () => {
    if (speaking) {
      stopSpeech();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(text, () => setSpeaking(false));
  };

  return (
    <button
      type="button"
      className="btn btn-secondary btn-speak"
      onClick={toggle}
      aria-label={speaking ? 'Stop reading' : label}
    >
      <span aria-hidden="true">{speaking ? '◼' : '▶'}</span>
      {speaking ? 'Stop' : 'Read aloud'}
    </button>
  );
}

/** Everything on the results panel, as one spoken passage. */
export function spokenPlan(
  destination: string,
  count: number,
  summary: string,
  trips: TripOption[],
  limit = 5,
): string {
  if (count === 0) return 'No trips found.';

  const parts = [
    `${count} trip${count === 1 ? '' : 's'} to ${destination}. ${summary}.`,
    // Reading twenty departures aloud is not useful; the next few are.
    `Here ${Math.min(limit, trips.length) === 1 ? 'is the next one' : `are the next ${Math.min(limit, trips.length)}`}.`,
  ];

  trips.slice(0, limit).forEach((trip, index) => {
    parts.push(
      `${index + 1}. The ${trip.route_id} train toward ${trip.trip_headsign}, ` +
        `departing ${spokenTime(trip.depart)}, arriving ${spokenTime(trip.arrive)}. ` +
        `${severitySpoken[trip.severity]}.` +
        (trip.advisories.length ? ` ${trip.advisories.join('. ')}.` : ''),
    );
  });

  return parts.join(' ');
}

// -- states ---------------------------------------------------------------

export function Loading({ label }: { label: string }) {
  return (
    <p className="status" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-stop" role="alert">
      <h3>
        <span aria-hidden="true">✕</span> Something went wrong
      </h3>
      <p>{message}</p>
      {onRetry ? (
        <p>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
