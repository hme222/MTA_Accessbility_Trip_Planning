/**
 * Client for the accessible trip planning API.
 *
 * The severity vocabulary comes straight from the backend and is deliberately
 * not collapsed into a boolean: "you can get there but not back" is a different
 * problem from "you cannot board", and a rider needs to tell them apart.
 */

export type Severity = 'step_free' | 'return_warning' | 'outbound_warning';

/** MTA convention, not GTFS: 2 means partial here, not "boarding impossible". */
export type AdaStatus = '0' | '1' | '2';

export interface Station {
  stop_id: string;
  stop_name: string;
  lat: number | null;
  lon: number | null;
  mta_ada_status: AdaStatus;
  northbound: boolean;
  southbound: boolean;
  reason: string;
  routes: string[];
}

export interface TripOption {
  trip_id: string;
  route_id: string;
  direction_id: string;
  trip_headsign: string;
  depart: string;
  arrive: string;
  severity: Severity;
  advisories: string[];
}

export interface PlanResponse {
  origin: Station;
  destination: Station;
  date: string;
  after: string;
  count: number;
  severity_counts: Record<Severity, number>;
  trips: TripOption[];
}

export interface Outage {
  equipment: string;
  type: 'elevator' | 'escalator';
  station_ids: string[];
  station_names: string[];
  serving: string;
  ada: boolean;
  redundant: boolean;
  blocking: boolean;
  reason: string;
  outage_date: string;
  estimated_return: string;
}

export interface OutageResponse {
  fetched_at: number;
  total: number;
  blocking: number;
  outages: Outage[];
}

/**
 * A configured backend selects live mode. Without one, the static Pages build
 * uses the bounded demonstration adapter instead of issuing doomed `/api`
 * requests to GitHub Pages.
 */
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
export const DATA_MODE = configuredApiUrl ? 'live' : 'demo';
export const IS_DEMO = DATA_MODE === 'demo';
const BASE_URL = (configuredApiUrl || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function get<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  if (IS_DEMO) {
    const { demoGet } = await import('./demoApi');
    return demoGet<T>(path, params, signal);
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const url = `${BASE_URL}${path}${query.size ? `?${query}` : ''}`;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Nearly always the backend not running. Say that, rather than "Failed to fetch".
    throw new ApiError(
      import.meta.env.DEV
        ? 'Could not reach the trip planning service. Start it with: uvicorn api.main:app --port 8000'
        : 'The live trip service could not be reached. Your choices are still here; try again.',
    );
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) {
        detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      /* keep the status-code message */
    }
    throw new ApiError(detail, response.status);
  }

  return (await response.json()) as T;
}

export function fetchStations(signal?: AbortSignal): Promise<Station[]> {
  return get<Station[]>('/stations', { limit: 600 }, signal);
}

export function fetchPlan(
  origin: string,
  destination: string,
  options: { date?: string; after?: string; limit?: number; requireStepFree?: boolean } = {},
  signal?: AbortSignal,
): Promise<PlanResponse> {
  return get<PlanResponse>(
    '/plan',
    {
      origin,
      destination,
      date: options.date,
      after: options.after,
      limit: options.limit ?? 20,
      require_step_free: options.requireStepFree ?? false,
    },
    signal,
  );
}

export function fetchOutages(signal?: AbortSignal): Promise<OutageResponse> {
  return get<OutageResponse>('/outages', {}, signal);
}

export interface Alternative {
  stop_id: string;
  stop_name: string;
  routes: string[];
  shared_routes: string[];
  northbound: boolean;
  southbound: boolean;
  reason: string;
  /** Straight-line distance. Always shorter than the actual walk. */
  meters: number;
}

export function fetchAlternatives(
  stopId: string,
  options: { direction?: 'N' | 'S'; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Alternative[]> {
  return get<Alternative[]>(
    `/stations/${encodeURIComponent(stopId)}/alternatives`,
    { direction: options.direction, limit: options.limit ?? 3 },
    signal,
  );
}

/** Distance in the units a New Yorker actually thinks in. */
export function describeDistance(meters: number): string {
  if (meters < 800) {
    // ~80 m per short block; useful and familiar, but rounded, not precise.
    const blocks = Math.max(1, Math.round(meters / 80));
    return `${blocks} block${blocks === 1 ? '' : 's'} away`;
  }
  return `${(meters / 1609).toFixed(1)} miles away`;
}

export interface Ramp {
  ramp_id: string;
  street: string;
  running_slope: number | null;
  cross_slope: number | null;
  width_inches: number | null;
  compliant: boolean;
  measured: boolean;
  issues: string[];
}

export interface RampReport {
  total: number;
  compliant: number;
  substandard: number;
  unverified: number;
  ramps: Ramp[];
  error?: string | null;
}

export function fetchRamps(
  stopId: string,
  meters = 200,
  signal?: AbortSignal,
): Promise<RampReport> {
  return get<RampReport>(
    `/stations/${encodeURIComponent(stopId)}/ramps`,
    { meters },
    signal,
  );
}

export interface StationEquipment {
  equipment: string;
  type: 'elevator' | 'escalator';
  serving: string;
  ada: boolean;
  redundant: boolean;
  working: boolean;
  reason: string;
  estimated_return: string;
}

export function fetchAllEquipment(
  stopId: string,
  signal?: AbortSignal,
): Promise<StationEquipment[]> {
  return get<StationEquipment[]>(
    `/stations/${encodeURIComponent(stopId)}/all-equipment`,
    {},
    signal,
  );
}

export interface PlannedOutage {
  equipment: string;
  type: 'elevator' | 'escalator';
  station_ids: string[];
  station_names: string[];
  serving: string;
  ada: boolean;
  redundant: boolean;
  will_block: boolean;
  reason: string;
  starts: string;
  ends: string;
}

export interface PlannedOutageResponse {
  fetched_at: number;
  total: number;
  blocking: number;
  outages: PlannedOutage[];
}

export function fetchPlannedOutages(signal?: AbortSignal): Promise<PlannedOutageResponse> {
  return get<PlannedOutageResponse>('/outages/upcoming', { limit: 200 }, signal);
}

export interface Equipment {
  equipment: string;
  type: 'elevator' | 'escalator';
  serving: string;
  ada: boolean;
  redundant: boolean;
  blocking: boolean;
  reason: string;
  outage_date: string;
  estimated_return: string;
}

export function fetchEquipment(stopId: string, signal?: AbortSignal): Promise<Equipment[]> {
  return get<Equipment[]>(`/stations/${encodeURIComponent(stopId)}/equipment`, {}, signal);
}

/**
 * "08/20/2026 06:00:00 AM" -> "Thu Aug 20, 6:00 AM".
 *
 * Returned unchanged if it does not parse: showing the MTA's raw string is
 * better than showing "Invalid Date" for a fact a rider may be relying on.
 */
export function formatOutageTime(value: string): string {
  if (!value) return '';
  const parsed = new Date(value.replace(/-/g, '/'));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface TransferLeg {
  route: string;
  headsign: string;
  depart: string;
  arrive: string;
}

export interface TransferOption {
  depart: string;
  arrive: string;
  total_minutes: number;
  wait_minutes: number;
  /** Where leg one ends. */
  arrive_station: string;
  arrive_name: string;
  /** Where leg two boards — often a different GTFS parent of the same station. */
  transfer_station: string;
  transfer_name: string;
  /** The two are named differently, so the change involves a walk. */
  walk_between: boolean;
  /** Lines serving the boarding stop, so the change is visibly possible. */
  transfer_routes: string[];
  leg_1: TransferLeg;
  leg_2: TransferLeg;
  severity: Severity;
  advisories: string[];
}

export interface TransferResponse {
  origin: Station;
  destination: Station;
  count: number;
  options: TransferOption[];
}

export function fetchTransfers(
  origin: string,
  destination: string,
  options: { date?: string; after?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<TransferResponse> {
  return get<TransferResponse>(
    '/plan/transfers',
    { origin, destination, date: options.date, after: options.after, limit: options.limit ?? 8 },
    signal,
  );
}

export interface BusAlert {
  id: string;
  routes: string[];
  header: string;
  description: string;
  alert_type: string;
  updated_at: number | null;
}

export interface BusAlertResponse {
  fetched_at: number;
  total: number;
  alerts: BusAlert[];
  error?: string;
}

export function fetchBusAlerts(
  route?: string,
  signal?: AbortSignal,
): Promise<BusAlertResponse> {
  return get<BusAlertResponse>('/bus/alerts', { route, limit: 60 }, signal);
}

export interface Health {
  status: string;
  stations: number;
  /** Unix seconds when the feed's accessibility verdicts were resolved. */
  feed_built_at: number | null;
}

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return get<Health>('/health', {}, signal);
}

/**
 * How stale the accessibility data is, in words.
 *
 * The feed is a snapshot and elevator outages change hourly, so a rider
 * deciding whether to trust a step-free verdict needs its age stated plainly
 * rather than implied to be live.
 */
export function describeAge(builtAt: number | null): { text: string; stale: boolean } | null {
  if (!builtAt) return null;
  const minutes = Math.max(0, Math.round((Date.now() - builtAt * 1000) / 60000));
  const stale = minutes >= 180;

  if (minutes < 1) return { text: 'just now', stale };
  if (minutes < 60) return { text: `${minutes} minute${minutes === 1 ? '' : 's'} ago`, stale };

  const hours = Math.round(minutes / 60);
  if (hours < 24) return { text: `${hours} hour${hours === 1 ? '' : 's'} ago`, stale };

  const days = Math.round(hours / 24);
  return { text: `${days} day${days === 1 ? '' : 's'} ago`, stale };
}

/** "20260817" + "14:05:00" -> the values an <input type="date"/"time"> wants. */
export function toInputValues(date: string, time: string) {
  return {
    date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    time: time.slice(0, 5),
  };
}

/** The inverse: form values back into the GTFS shapes the API expects. */
export function fromInputValues(date: string, time: string) {
  return { date: date.replaceAll('-', ''), after: `${time}:00` };
}

// -- presentation helpers -------------------------------------------------

/** "09:04:30" -> "9:04 AM". GTFS hours can exceed 24 for after-midnight service. */
export function formatTime(gtfsTime: string): string {
  const [rawHour, minute] = gtfsTime.split(':');
  const hour24 = parseInt(rawHour, 10) % 24;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${suffix}`;
}

/** Screen readers should say "9:04 AM", not "nine colon zero four". */
export function spokenTime(gtfsTime: string): string {
  const [rawHour, minute] = gtfsTime.split(':');
  const hour24 = parseInt(rawHour, 10) % 24;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minutes = parseInt(minute, 10);
  if (minutes === 0) return `${hour12} ${suffix}`;
  return `${hour12} ${minutes < 10 ? 'oh ' : ''}${minutes} ${suffix}`;
}

export function durationMinutes(depart: string, arrive: string): number {
  const toSeconds = (t: string) => {
    const [h, m, s] = t.split(':').map((n) => parseInt(n, 10));
    return h * 3600 + m * 60 + (s || 0);
  };
  return Math.max(0, Math.round((toSeconds(arrive) - toSeconds(depart)) / 60));
}

export function todayInNewYork(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${at('year')}${at('month')}${at('day')}`,
    // Intl renders midnight as "24" in some engines; GTFS wants "00".
    time: `${at('hour') === '24' ? '00' : at('hour')}:${at('minute')}:${at('second')}`,
  };
}

// -- vocabulary -----------------------------------------------------------

/**
 * Rider-facing vocabulary.
 *
 * The wording follows ADA terminology — "accessible" and "accessible route" —
 * rather than "step-free". The severity keys themselves are left alone; they
 * are the API contract, not copy.
 */
export const severityLabel: Record<Severity, string> = {
  step_free: 'ADA accessible',
  return_warning: 'Return not accessible',
  outbound_warning: 'Not accessible',
};

/** Full sentences for screen readers, where an abbreviation would not land. */
export const severitySpoken: Record<Severity, string> = {
  step_free: 'ADA accessible the whole way, there and back',
  return_warning: 'ADA accessible getting there, but the return trip is not',
  outbound_warning: 'This trip is not ADA accessible',
};

/** Non-color redundancy. The three glyphs differ in shape, not just hue. */
export const severityGlyph: Record<Severity, string> = {
  step_free: '✓',
  return_warning: '↺',
  outbound_warning: '✕',
};

export function accessSummary(station: Station): string {
  if (station.northbound && station.southbound) return 'ADA accessible in both directions';
  if (station.northbound) return 'ADA accessible uptown only';
  if (station.southbound) return 'ADA accessible downtown only';
  return 'Not ADA accessible';
}

export function accessLevel(station: Station): 'full' | 'partial' | 'none' {
  if (station.northbound && station.southbound) return 'full';
  if (station.northbound || station.southbound) return 'partial';
  return 'none';
}

export function spokenRoutes(routes: string[]): string {
  if (!routes.length) return '';
  if (routes.length === 1) return `${routes[0]} train`;
  return `${routes.slice(0, -1).join(', ')} and ${routes[routes.length - 1]} trains`;
}
