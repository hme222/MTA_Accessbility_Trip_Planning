/**
 * Bounded data adapter for the static GitHub Pages demonstration.
 *
 * This is not a mock of the whole MTA. It is a representative station set
 * that exercises the existing planner without pretending a static host can
 * provide current service information.
 */
import type {
  Alternative,
  BusAlertResponse,
  Equipment,
  Health,
  OutageResponse,
  PlanResponse,
  PlannedOutageResponse,
  RampReport,
  Severity,
  Station,
  StationEquipment,
  TransferResponse,
  TripOption,
} from './api';

type Params = Record<string, string | number | boolean | undefined>;
type Direction = 'northbound' | 'southbound';

export const DEMO_SNAPSHOT_ISO = '2026-08-16T16:00:00-04:00';

const stations: Station[] = [
  {
    stop_id: 'R16', stop_name: 'Times Sq-42 St', lat: 40.7547, lon: -73.9867,
    mta_ada_status: '1', northbound: true, southbound: true,
    reason: 'Accessible in both directions in this demonstration snapshot.',
    routes: ['N', 'Q', 'R', 'W'],
  },
  {
    stop_id: 'R15', stop_name: '49 St', lat: 40.7604, lon: -73.984,
    mta_ada_status: '2', northbound: true, southbound: false,
    reason: 'Accessible uptown only; the downtown platform has no accessible route.',
    routes: ['N', 'R', 'W'],
  },
  {
    stop_id: 'R14', stop_name: '57 St-7 Av', lat: 40.7647, lon: -73.9807,
    mta_ada_status: '1', northbound: true, southbound: true,
    reason: 'Accessible in both directions in this demonstration snapshot.',
    routes: ['N', 'Q', 'R', 'W'],
  },
  {
    stop_id: 'R20', stop_name: '14 St-Union Sq', lat: 40.7357, lon: -73.9907,
    mta_ada_status: '1', northbound: true, southbound: true,
    reason: 'Accessible in both directions in this demonstration snapshot.',
    routes: ['N', 'Q', 'R', 'W'],
  },
  {
    stop_id: 'A24', stop_name: '59 St-Columbus Circle', lat: 40.7683, lon: -73.9818,
    mta_ada_status: '1', northbound: true, southbound: true,
    reason: 'Accessible in both directions in this demonstration snapshot.',
    routes: ['A', 'B', 'C', 'D', '1'],
  },
  {
    stop_id: 'A27', stop_name: '42 St-Port Authority', lat: 40.7573, lon: -73.9897,
    mta_ada_status: '1', northbound: true, southbound: true,
    reason: 'Accessible in both directions in this demonstration snapshot.',
    routes: ['A', 'C', 'E'],
  },
  {
    stop_id: 'L03', stop_name: '14 St-Union Sq (L)', lat: 40.7348, lon: -73.9902,
    mta_ada_status: '1', northbound: true, southbound: true,
    reason: 'Accessible in both directions in this demonstration snapshot.',
    routes: ['L'],
  },
];

const stationById = new Map(stations.map((station) => [station.stop_id, station]));

const equipmentByStation: Record<string, StationEquipment[]> = {
  R16: [{
    equipment: 'EL230', type: 'elevator', serving: 'Street to mezzanine and N/Q/R/W platforms',
    ada: true, redundant: false, working: true, reason: '', estimated_return: '',
  }],
  R15: [{
    equipment: 'EL221', type: 'elevator', serving: 'Street and mezzanine to the uptown platform only',
    ada: true, redundant: false, working: true, reason: '', estimated_return: '',
  }],
  A24: [
    {
      equipment: 'EL178', type: 'elevator', serving: 'Street to mezzanine', ada: true,
      redundant: false, working: true, reason: '', estimated_return: '',
    },
    {
      equipment: 'EL179', type: 'elevator', serving: 'Mezzanine to downtown A/C platform',
      ada: true, redundant: false, working: false,
      reason: 'Demonstration of a blocking outage',
      estimated_return: '08/17/2026 06:00:00 AM',
    },
  ],
  A27: [{
    equipment: 'EL199', type: 'elevator', serving: 'Mezzanine to A/C/E platforms',
    ada: true, redundant: false, working: true, reason: '', estimated_return: '',
  }],
};

const outageResponse: OutageResponse = {
  fetched_at: Date.parse(DEMO_SNAPSHOT_ISO) / 1000,
  total: 2,
  blocking: 1,
  outages: [
    {
      equipment: 'EL179', type: 'elevator', station_ids: ['A24'],
      station_names: ['59 St-Columbus Circle'], serving: 'Mezzanine to downtown A/C platform',
      ada: true, redundant: false, blocking: true,
      reason: 'Demonstration of a blocking outage',
      outage_date: '08/16/2026 09:00:00 AM', estimated_return: '08/17/2026 06:00:00 AM',
    },
    {
      equipment: 'ES144', type: 'escalator', station_ids: ['R16'],
      station_names: ['Times Sq-42 St'], serving: 'Mezzanine to street',
      ada: false, redundant: false, blocking: false,
      reason: 'Demonstration maintenance record',
      outage_date: '08/16/2026 10:00:00 AM', estimated_return: '08/16/2026 08:00:00 PM',
    },
  ],
};

const plannedResponse: PlannedOutageResponse = {
  fetched_at: Date.parse(DEMO_SNAPSHOT_ISO) / 1000,
  total: 2,
  blocking: 1,
  outages: [
    {
      equipment: 'EL221', type: 'elevator', station_ids: ['R15'], station_names: ['49 St'],
      serving: 'Street and mezzanine to the uptown platform', ada: true, redundant: false,
      will_block: true, reason: 'Scheduled inspection in the demonstration snapshot',
      starts: '08/20/2026 10:00:00 PM', ends: '08/21/2026 05:00:00 AM',
    },
    {
      equipment: 'ES144', type: 'escalator', station_ids: ['R16'],
      station_names: ['Times Sq-42 St'], serving: 'Mezzanine to street',
      ada: false, redundant: false, will_block: false,
      reason: 'Scheduled maintenance in the demonstration snapshot',
      starts: '08/22/2026 01:00:00 AM', ends: '08/22/2026 05:00:00 AM',
    },
  ],
};

const busResponse: BusAlertResponse = {
  fetched_at: Date.parse(DEMO_SNAPSHOT_ISO) / 1000,
  total: 2,
  alerts: [
    {
      id: 'demo-m7', routes: ['M7'], header: 'Demonstration detour near Columbus Circle',
      description: 'Sample alert for testing the accessible fallback and filtering interface.',
      alert_type: 'detour', updated_at: Date.parse(DEMO_SNAPSHOT_ISO) / 1000,
    },
    {
      id: 'demo-m14a', routes: ['M14A+'], header: 'Demonstration stop change near Union Square',
      description: 'Sample alert only. Check the MTA before traveling.',
      alert_type: 'stop change', updated_at: Date.parse(DEMO_SNAPSHOT_ISO) / 1000,
    },
  ],
};

function requireStation(stopId: string): Station {
  const station = stationById.get(stopId);
  if (!station) throw new Error(`No demonstration station with stop_id ${stopId}.`);
  return station;
}

function timePlus(value: string, minutes: number): string {
  const parts = value.split(':').map(Number);
  const total = (parts[0] || 0) * 60 + (parts[1] || 0) + minutes;
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function routeDirection(origin: Station, destination: Station): Direction {
  return (destination.lat ?? 0) >= (origin.lat ?? 0) ? 'northbound' : 'southbound';
}

function plan(params: Params): PlanResponse {
  const origin = requireStation(String(params.origin));
  const destination = requireStation(String(params.destination));
  const direction = routeDirection(origin, destination);
  const opposite: Direction = direction === 'northbound' ? 'southbound' : 'northbound';
  const shared = origin.routes.filter((route) => destination.routes.includes(route)).slice(0, 2);
  const after = String(params.after ?? '09:00:00');

  let severity: Severity = 'step_free';
  const advisories: string[] = [];
  if (!origin[direction] || !destination[direction]) {
    severity = 'outbound_warning';
    advisories.push(`${direction === 'northbound' ? 'uptown' : 'downtown'} boarding or exit is not ADA accessible`);
  } else if (!destination[opposite]) {
    severity = 'return_warning';
    advisories.push(`return trip from ${destination.stop_name} is not ADA accessible`);
  }

  let trips: TripOption[] = shared.map((route, index) => {
    const depart = timePlus(after, 2 + index * 5);
    return {
      trip_id: `demo-${origin.stop_id}-${destination.stop_id}-${route}-${index}`,
      route_id: route,
      direction_id: direction === 'northbound' ? '0' : '1',
      trip_headsign: direction === 'northbound' ? 'Uptown & Queens' : 'Downtown & Brooklyn',
      depart,
      arrive: timePlus(depart, 4 + index),
      severity,
      advisories,
    };
  });

  if (params.require_step_free === true || params.require_step_free === 'true') {
    trips = trips.filter((trip) => trip.severity === 'step_free');
  }

  const severityCounts: Record<Severity, number> = {
    step_free: 0, return_warning: 0, outbound_warning: 0,
  };
  for (const trip of trips) severityCounts[trip.severity] += 1;

  return {
    origin, destination, date: String(params.date ?? '20260816'), after,
    count: trips.length, severity_counts: severityCounts, trips,
  };
}

function transfers(params: Params): TransferResponse {
  const origin = requireStation(String(params.origin));
  const destination = requireStation(String(params.destination));
  const after = String(params.after ?? '09:00:00');
  const supported = `${origin.stop_id}:${destination.stop_id}` === 'A24:R20';
  if (!supported) return { origin, destination, count: 0, options: [] };

  const depart = timePlus(after, 4);
  const firstArrive = timePlus(depart, 8);
  const secondDepart = timePlus(firstArrive, 7);
  const arrive = timePlus(secondDepart, 9);
  return {
    origin, destination, count: 1,
    options: [{
      depart, arrive, total_minutes: 24, wait_minutes: 7,
      arrive_station: 'A27', arrive_name: '42 St-Port Authority',
      transfer_station: 'R16', transfer_name: 'Times Sq-42 St', walk_between: true,
      transfer_routes: ['N', 'Q', 'R', 'W'],
      leg_1: { route: 'A', headsign: 'Downtown & Brooklyn', depart, arrive: firstArrive },
      leg_2: { route: 'R', headsign: 'Downtown & Brooklyn', depart: secondDepart, arrive },
      severity: 'step_free',
      advisories: ['verify the accessible connection between Port Authority and Times Square before relying on it'],
    }],
  };
}

function alternatives(stopId: string, params: Params): Alternative[] {
  const source = requireStation(stopId);
  const direction = params.direction === 'N' ? 'northbound' : params.direction === 'S' ? 'southbound' : null;
  const distances: Record<string, number> = { R14: 520, R16: 690, A24: 820, A27: 760 };
  return stations
    .filter((station) => station.stop_id !== stopId)
    .filter((station) => (direction ? station[direction] : station.northbound && station.southbound))
    .map((station) => ({
      stop_id: station.stop_id,
      stop_name: station.stop_name,
      routes: station.routes,
      shared_routes: station.routes.filter((route) => source.routes.includes(route)),
      northbound: station.northbound,
      southbound: station.southbound,
      reason: station.reason,
      meters: distances[station.stop_id] ?? 1100,
    }))
    .sort((a, b) => Number(b.shared_routes.length > 0) - Number(a.shared_routes.length > 0) || a.meters - b.meters)
    .slice(0, Number(params.limit ?? 3));
}

function ramps(stopId: string): RampReport {
  const rows = stopId === 'R14' ? [
    {
      ramp_id: 'demo-ramp-1', street: '7 Av & W 57 St', running_slope: 7.4,
      cross_slope: 1.8, width_inches: 42, compliant: true, measured: true, issues: [],
    },
    {
      ramp_id: 'demo-ramp-2', street: 'Broadway & W 57 St', running_slope: 10.1,
      cross_slope: 2.4, width_inches: 38, compliant: false, measured: true,
      issues: ['running slope exceeds 8.33%', 'cross slope exceeds 2.08%'],
    },
  ] : [];
  return {
    total: rows.length,
    compliant: rows.filter((row) => row.compliant).length,
    substandard: rows.filter((row) => !row.compliant).length,
    unverified: rows.filter((row) => !row.measured).length,
    ramps: rows,
  };
}

function stationOutages(stopId: string): Equipment[] {
  return outageResponse.outages
    .filter((outage) => outage.station_ids.includes(stopId))
    .map((outage) => ({
      equipment: outage.equipment, type: outage.type, serving: outage.serving,
      ada: outage.ada, redundant: outage.redundant, blocking: outage.blocking,
      reason: outage.reason, outage_date: outage.outage_date,
      estimated_return: outage.estimated_return,
    }));
}

async function settle(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 80);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('The request was cancelled.', 'AbortError'));
    }, { once: true });
  });
}

export async function demoGet<T>(path: string, params: Params, signal?: AbortSignal): Promise<T> {
  await settle(signal);
  let result: unknown;
  if (path === '/stations') result = stations;
  else if (path === '/plan') result = plan(params);
  else if (path === '/plan/transfers') result = transfers(params);
  else if (path === '/outages') result = outageResponse;
  else if (path === '/outages/upcoming') result = plannedResponse;
  else if (path === '/bus/alerts') result = busResponse;
  else if (path === '/health') {
    result = {
      status: 'demo', stations: stations.length,
      feed_built_at: Date.parse(DEMO_SNAPSHOT_ISO) / 1000,
    } satisfies Health;
  } else {
    const match = path.match(/^\/stations\/([^/]+)\/(alternatives|ramps|equipment|all-equipment)$/);
    if (!match) throw new Error(`The static demonstration does not implement ${path}.`);
    const stopId = decodeURIComponent(match[1]);
    const resource = match[2];
    if (resource === 'alternatives') result = alternatives(stopId, params);
    else if (resource === 'ramps') result = ramps(stopId);
    else if (resource === 'equipment') result = stationOutages(stopId);
    else result = equipmentByStation[stopId] ?? [];
  }
  return structuredClone(result) as T;
}
