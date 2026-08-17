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
  PublicDataSession,
  RampReport,
  Severity,
  Station,
  StationEquipment,
  TransferResponse,
  TripOption,
} from './api';

type Params = Record<string, string | number | boolean | undefined>;
type Direction = 'northbound' | 'southbound';

type MtaStationRow = {
  gtfs_stop_id?: string;
  stop_name?: string;
  daytime_routes?: string;
  gtfs_latitude?: string;
  gtfs_longitude?: string;
  ada?: string;
  ada_northbound?: string;
  ada_southbound?: string;
  ada_notes?: string;
};

type MtaEquipmentRow = {
  station?: string;
  equipmentno?: string;
  equipmenttype?: string;
  serving?: string;
  ADA?: string;
  redundant?: number | string;
  elevatorsgtfsstopid?: string;
};

type MtaOutageRow = {
  equipment?: string;
  reason?: string;
  outagedate?: string;
  estimatedreturntoservice?: string;
};

type MtaBusFeed = {
  entity?: Array<{
    id?: string;
    alert?: {
      informed_entity?: Array<{ route_id?: string }>;
      header_text?: TranslationBlock;
      description_text?: TranslationBlock;
      'transit_realtime.mercury_alert'?: {
        alert_type?: string;
        updated_at?: number;
      };
    };
  }>;
};

type TranslationBlock = {
  translation?: Array<{ text?: string; language?: string }>;
};

type NycRampRow = Record<string, string | undefined>;

export const DEMO_SNAPSHOT_ISO = '2026-08-16T16:00:00-04:00';
export const SESSION_OPENED_AT = Date.now();

const MTA_STATIONS_URL = 'https://data.ny.gov/resource/39hk-dx4f.json?$limit=600';
const MTA_EQUIPMENT_URL =
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene_equipments.json';
const MTA_ACTIVE_OUTAGES_URL =
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene.json';
const MTA_UPCOMING_OUTAGES_URL =
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene_upcoming.json';
const MTA_BUS_ALERTS_URL =
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fbus-alerts.json';
const NYC_RAMPS_URL = 'https://data.cityofnewyork.us/resource/ufzp-rrqu.json';
const DEMO_BUS_ROUTES = new Set(['M7', 'M42', 'M104', 'M14A+', 'M14D+']);

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
  {
    stop_id: 'BUS_M42_7AV', stop_name: 'W 42 St & 7 Av', lat: 40.7559, lon: -73.9871,
    mta_ada_status: '1', northbound: true, southbound: true, kind: 'bus',
    reason: 'Representative M42 stop. MTA buses have a ramp or lift and kneel at the curb.',
    routes: ['M42'],
  },
  {
    stop_id: 'BUS_M42_8AV', stop_name: 'W 42 St & 8 Av', lat: 40.7571, lon: -73.9895,
    mta_ada_status: '1', northbound: true, southbound: true, kind: 'bus',
    reason: 'Representative M42 stop. MTA buses have a ramp or lift and kneel at the curb.',
    routes: ['M42'],
  },
  {
    stop_id: 'BUS_M7_59', stop_name: 'Columbus Circle & W 59 St', lat: 40.768, lon: -73.9829,
    mta_ada_status: '1', northbound: true, southbound: true, kind: 'bus',
    reason: 'Representative M7 and M104 stop. MTA buses have a ramp or lift and kneel at the curb.',
    routes: ['M7', 'M104'],
  },
  {
    stop_id: 'BUS_M14_UNION', stop_name: 'E 14 St & Union Square E', lat: 40.7349, lon: -73.989,
    mta_ada_status: '1', northbound: true, southbound: true, kind: 'bus',
    reason: 'Representative Select Bus Service stop. MTA buses have a ramp or lift and kneel at the curb.',
    routes: ['M14A+', 'M14D+'],
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

async function fetchPublicJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

function splitGtfsIds(value = ''): string[] {
  return value.split(/[\s,/]+/).map((part) => part.trim()).filter(Boolean);
}

function isRedundant(value: number | string | undefined): boolean {
  return Number(value ?? 0) !== 0;
}

function updateMtaStations(rows: MtaStationRow[]): void {
  for (const row of rows) {
    if (!row.gtfs_stop_id) continue;
    const station = stationById.get(row.gtfs_stop_id);
    if (!station || station.kind === 'bus') continue;

    const status = row.ada === '1' || row.ada === '2' ? row.ada : '0';
    station.stop_name = row.stop_name || station.stop_name;
    station.lat = Number.isFinite(Number(row.gtfs_latitude))
      ? Number(row.gtfs_latitude)
      : station.lat;
    station.lon = Number.isFinite(Number(row.gtfs_longitude))
      ? Number(row.gtfs_longitude)
      : station.lon;
    station.routes = row.daytime_routes?.split(/\s+/).filter(Boolean) || station.routes;
    station.mta_ada_status = status;
    station.northbound = row.ada_northbound === '1';
    station.southbound = row.ada_southbound === '1';
    station.reason =
      status === '2'
        ? row.ada_notes || 'MTA lists this station as accessible in one direction.'
        : status === '1'
          ? 'MTA lists this station as ADA accessible in both directions.'
          : 'MTA does not list this station as ADA accessible.';
  }
}

async function refreshMtaStationData(): Promise<void> {
  updateMtaStations(await fetchPublicJson<MtaStationRow[]>(MTA_STATIONS_URL));
}

async function refreshMtaEquipmentData(): Promise<void> {
  const [equipmentRows, activeRows, upcomingRows] = await Promise.all([
    fetchPublicJson<MtaEquipmentRow[]>(MTA_EQUIPMENT_URL),
    fetchPublicJson<MtaOutageRow[]>(MTA_ACTIVE_OUTAGES_URL),
    fetchPublicJson<MtaOutageRow[]>(MTA_UPCOMING_OUTAGES_URL),
  ]);

  const equipmentById = new Map(
    equipmentRows
      .filter((row) => row.equipmentno)
      .map((row) => [row.equipmentno as string, row]),
  );
  const activeById = new Map(
    activeRows.filter((row) => row.equipment).map((row) => [row.equipment as string, row]),
  );

  const current: OutageResponse['outages'] = [];
  const perStation: Record<string, StationEquipment[]> = {};

  for (const equipment of equipmentRows) {
    if (!equipment.equipmentno) continue;
    const stationIds = splitGtfsIds(equipment.elevatorsgtfsstopid);
    const active = activeById.get(equipment.equipmentno);
    const elevator = equipment.equipmenttype === 'EL';
    const redundant = isRedundant(equipment.redundant);
    const blocking = elevator && equipment.ADA === 'Y' && !redundant;

    for (const stationId of stationIds) {
      if (!stationById.has(stationId)) continue;
      (perStation[stationId] ??= []).push({
        equipment: equipment.equipmentno,
        type: elevator ? 'elevator' : 'escalator',
        serving: equipment.serving || '',
        ada: equipment.ADA === 'Y',
        redundant,
        working: !active,
        reason: active?.reason || '',
        estimated_return: active?.estimatedreturntoservice || '',
      });
    }

    if (!active) continue;
    current.push({
      equipment: equipment.equipmentno,
      type: elevator ? 'elevator' : 'escalator',
      station_ids: stationIds,
      station_names: equipment.station ? [equipment.station] : [],
      serving: equipment.serving || '',
      ada: equipment.ADA === 'Y',
      redundant,
      blocking,
      reason: active.reason || '',
      outage_date: active.outagedate || '',
      estimated_return: active.estimatedreturntoservice || '',
    });
  }

  for (const [stationId, items] of Object.entries(perStation)) {
    items.sort((a, b) => Number(a.working) - Number(b.working) || a.equipment.localeCompare(b.equipment));
    equipmentByStation[stationId] = items;
  }

  current.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.equipment.localeCompare(b.equipment));
  outageResponse.fetched_at = Date.now() / 1000;
  outageResponse.outages = current;
  outageResponse.total = current.length;
  outageResponse.blocking = current.filter((item) => item.blocking).length;

  for (const outage of current) {
    if (!outage.blocking) continue;
    for (const stationId of outage.station_ids) {
      const station = stationById.get(stationId);
      if (!station || station.kind === 'bus') continue;
      station.northbound = false;
      station.southbound = false;
      station.reason = `MTA reports ADA elevator ${outage.equipment} out of service: ${outage.reason || 'reason not published'}.`;
    }
  }

  const upcoming = upcomingRows.flatMap((row) => {
    if (!row.equipment) return [];
    const equipment = equipmentById.get(row.equipment);
    if (!equipment) return [];
    const elevator = equipment.equipmenttype === 'EL';
    const redundant = isRedundant(equipment.redundant);
    return [{
      equipment: row.equipment,
      type: elevator ? 'elevator' as const : 'escalator' as const,
      station_ids: splitGtfsIds(equipment.elevatorsgtfsstopid),
      station_names: equipment.station ? [equipment.station] : [],
      serving: equipment.serving || '',
      ada: equipment.ADA === 'Y',
      redundant,
      will_block: elevator && equipment.ADA === 'Y' && !redundant,
      reason: row.reason || '',
      starts: row.outagedate || '',
      ends: row.estimatedreturntoservice || '',
    }];
  });
  plannedResponse.fetched_at = Date.now() / 1000;
  plannedResponse.outages = upcoming;
  plannedResponse.total = upcoming.length;
  plannedResponse.blocking = upcoming.filter((item) => item.will_block).length;
}

function textOf(block?: TranslationBlock): string {
  const translations = block?.translation || [];
  return (
    translations.find((item) => (item.language || 'en').startsWith('en') && item.text)?.text ||
    translations[0]?.text ||
    ''
  ).trim();
}

function normalizeBusRoute(route: string): string {
  return route.toUpperCase().replace(/-SBS$/, '+');
}

async function refreshMtaBusAlerts(): Promise<void> {
  const payload = await fetchPublicJson<MtaBusFeed>(MTA_BUS_ALERTS_URL);
  const alerts = (payload.entity || []).flatMap((entity) => {
    const alert = entity.alert;
    if (!alert) return [];
    const routes = [...new Set(
      (alert.informed_entity || []).map((item) => item.route_id).filter((route): route is string => Boolean(route)),
    )].sort();
    if (!routes.some((route) => DEMO_BUS_ROUTES.has(normalizeBusRoute(route)))) return [];
    const mercury = alert['transit_realtime.mercury_alert'];
    return [{
      id: entity.id || routes.join('-'),
      routes,
      header: textOf(alert.header_text),
      description: textOf(alert.description_text),
      alert_type: mercury?.alert_type || '',
      updated_at: mercury?.updated_at ?? null,
    }];
  }).slice(0, 40);

  busResponse.fetched_at = Date.now() / 1000;
  busResponse.alerts = alerts;
  busResponse.total = alerts.length;
  delete busResponse.error;
}

async function checkNycRampSource(): Promise<void> {
  await fetchPublicJson<NycRampRow[]>(`${NYC_RAMPS_URL}?$select=rampid&$limit=1`);
}

let sessionPromise: Promise<PublicDataSession> | null = null;

function refreshPublicDataSession(): Promise<PublicDataSession> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    // Station metadata establishes the baseline accessibility state. Apply live
    // elevator outages after it so an out-of-service elevator cannot be
    // overwritten by a slower station response.
    const independentSources = Promise.allSettled([
      refreshMtaBusAlerts(),
      checkNycRampSource(),
    ]);
    const [stationResult] = await Promise.allSettled([refreshMtaStationData()]);
    const [equipmentResult] = await Promise.allSettled([refreshMtaEquipmentData()]);
    const [busResult, rampResult] = await independentSources;
    const results = [stationResult, equipmentResult, busResult, rampResult];
    const labels = ['MTA station accessibility', 'MTA elevator status', 'MTA bus alerts', 'NYC curb ramps'];
    return {
      opened_at: SESSION_OPENED_AT,
      refreshed_at: Date.now(),
      sources: {
        mta_stations: results[0].status === 'fulfilled',
        mta_equipment: results[1].status === 'fulfilled',
        mta_bus_alerts: results[2].status === 'fulfilled',
        nyc_curb_ramps: results[3].status === 'fulfilled',
      },
      errors: results.flatMap((result, index) =>
        result.status === 'rejected' ? [`${labels[index]} could not refresh.`] : [],
      ),
    };
  })();
  return sessionPromise;
}

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
  const originIsBus = origin.kind === 'bus';
  const destinationIsBus = destination.kind === 'bus';
  const mixedMode = originIsBus !== destinationIsBus;
  const mixedBusRoute = origin.kind === 'bus' ? origin.routes[0] : destination.kind === 'bus' ? destination.routes[0] : null;
  const services = shared.length ? shared : mixedMode && mixedBusRoute ? [mixedBusRoute] : [];
  const after = String(params.after ?? '09:00:00');

  let severity: Severity = 'step_free';
  const advisories: string[] = [];
  if (!mixedMode && origin.kind !== 'bus' && destination.kind !== 'bus' && (!origin[direction] || !destination[direction])) {
    severity = 'outbound_warning';
    advisories.push(`${direction === 'northbound' ? 'uptown' : 'downtown'} boarding or exit is not ADA accessible`);
  } else if (destination.kind !== 'bus' && !destination[opposite]) {
    severity = 'return_warning';
    advisories.push(`return trip from ${destination.stop_name} is not ADA accessible`);
  }

  if (mixedMode) {
    advisories.push('includes a curb-to-entrance connection; review the ramp details and verify the walking path before travel');
  }

  let trips: TripOption[] = services.map((route, index) => {
    const depart = timePlus(after, 2 + index * 5);
    const bus = origin.kind === 'bus' || destination.kind === 'bus';
    return {
      trip_id: `demo-${origin.stop_id}-${destination.stop_id}-${route}-${index}`,
      route_id: route,
      direction_id: direction === 'northbound' ? '0' : '1',
      trip_headsign: bus
        ? ((destination.lon ?? 0) < (origin.lon ?? 0) ? 'Westbound' : 'Eastbound')
        : direction === 'northbound' ? 'Uptown & Queens' : 'Downtown & Brooklyn',
      depart,
      arrive: timePlus(depart, 4 + index),
      severity,
      advisories,
      mode: bus ? 'bus' : 'subway',
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

function fallbackRamps(stopId: string): RampReport {
  const sampleRows = [
    {
      ramp_id: 'demo-ramp-1', street: '7 Av & W 57 St', running_slope: 7.4,
      cross_slope: 1.8, width_inches: 42, compliant: true, measured: true, issues: [],
      detectable_warning: 'Good condition', surface_condition: 'Even', obstruction: null, ponding: false,
    },
    {
      ramp_id: 'demo-ramp-2', street: 'Broadway & W 57 St', running_slope: 10.1,
      cross_slope: 2.4, width_inches: 38, compliant: false, measured: true,
      issues: ['running slope exceeds 8.33%', 'cross slope exceeds 2.08%'],
      detectable_warning: 'Fair condition', surface_condition: 'Cracked', obstruction: 'Utility cover near landing', ponding: true,
    },
    {
      ramp_id: 'demo-ramp-3', street: 'W 42 St & 7 Av', running_slope: 6.8,
      cross_slope: 1.5, width_inches: 48, compliant: true, measured: true, issues: [],
      detectable_warning: 'Good condition', surface_condition: 'Even', obstruction: null, ponding: false,
    },
    {
      ramp_id: 'demo-ramp-4', street: 'W 42 St & 8 Av', running_slope: 9.2,
      cross_slope: 1.9, width_inches: 40, compliant: false, measured: true,
      issues: ['running slope exceeds 8.33%'], detectable_warning: 'Fair condition',
      surface_condition: 'Worn', obstruction: null, ponding: false,
    },
    {
      ramp_id: 'demo-ramp-5', street: 'Columbus Circle & W 59 St', running_slope: 7.1,
      cross_slope: 1.6, width_inches: 44, compliant: true, measured: true, issues: [],
      detectable_warning: 'Good condition', surface_condition: 'Even', obstruction: null, ponding: false,
    },
    {
      ramp_id: 'demo-ramp-6', street: 'Broadway & W 60 St', running_slope: 8.7,
      cross_slope: 2.2, width_inches: 35, compliant: false, measured: true,
      issues: ['running slope exceeds 8.33%', 'cross slope exceeds 2.08%', 'width is under 36 in'],
      detectable_warning: 'Worn', surface_condition: 'Uneven', obstruction: 'Signpost narrows the landing', ponding: false,
    },
    {
      ramp_id: 'demo-ramp-7', street: 'E 14 St & Union Square E', running_slope: 7.8,
      cross_slope: 1.7, width_inches: 45, compliant: true, measured: true, issues: [],
      detectable_warning: 'Good condition', surface_condition: 'Even', obstruction: null, ponding: false,
    },
  ];
  const rows = stopId === 'R14'
    ? sampleRows.slice(0, 2)
    : stopId === 'R16' || stopId.startsWith('BUS_M42')
      ? sampleRows.slice(2, 4)
      : stopId === 'A24' || stopId === 'BUS_M7_59'
        ? sampleRows.slice(4, 6)
        : stopId === 'R20' || stopId === 'L03' || stopId === 'BUS_M14_UNION'
          ? [sampleRows[6]]
          : [];
  return {
    fetched_at: Date.parse(DEMO_SNAPSHOT_ISO) / 1000,
    total: rows.length,
    compliant: rows.filter((row) => row.compliant).length,
    substandard: rows.filter((row) => !row.compliant).length,
    unverified: rows.filter((row) => !row.measured).length,
    ramps: rows,
  };
}

function numericRampValue(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed < 999 ? parsed : null;
}

function assessRamp(row: NycRampRow): RampReport['ramps'][number] {
  const running = numericRampValue(row.ramp_running_slope_total);
  const rawCross = numericRampValue(row.ramp_cross_slope);
  const cross = rawCross === null ? null : Math.abs(rawCross);
  const width = numericRampValue(row.ramp_width);
  const warning = (row.dws_conditions || '').trim();
  const obstruction = (row.obstacles_ramp || '').trim();
  const issues: string[] = [];

  if (running !== null && running > 8.33) {
    issues.push(`slope ${running.toFixed(1)}% exceeds the 8.33% ADA maximum`);
  }
  if (cross !== null && cross > 2.08) {
    issues.push(`cross slope ${cross.toFixed(1)}% exceeds the 2.08% ADA maximum`);
  }
  if (width !== null && width < 36) {
    issues.push(`width ${Math.round(width)} in is under the 36 in ADA minimum`);
  }
  if (warning && !['good condition', 'fair condition'].includes(warning.toLowerCase())) {
    issues.push(`detectable warning surface: ${warning.toLowerCase()}`);
  }
  if (obstruction && obstruction.toLowerCase() !== 'none') {
    issues.push(`obstruction: ${obstruction.toLowerCase()}`);
  }
  if ((row.ponding || '').toLowerCase() === 'yes') issues.push('ponds with water');

  const measured = running !== null || cross !== null || width !== null;
  return {
    ramp_id: row.rampid || '',
    street: row.ramp_onstr || row.stname1 || '',
    running_slope: running,
    cross_slope: cross,
    width_inches: width,
    compliant: measured && issues.length === 0,
    measured,
    issues,
    detectable_warning: warning || null,
    surface_condition: null,
    obstruction: obstruction || null,
    ponding: row.ponding ? row.ponding.toLowerCase() === 'yes' : null,
  };
}

async function publicRamps(stopId: string, meters: number): Promise<RampReport> {
  const station = requireStation(stopId);
  if (station.lat === null || station.lon === null) return fallbackRamps(stopId);

  const dlat = meters / 111_320;
  const dlon = meters / (111_320 * Math.max(0.1, Math.cos((station.lat * Math.PI) / 180)));
  const north = station.lat + dlat;
  const west = station.lon - dlon;
  const south = station.lat - dlat;
  const east = station.lon + dlon;
  const query = new URLSearchParams({
    '$where': `within_box(the_geom,${north},${west},${south},${east})`,
    '$select': [
      'rampid',
      'ramp_onstr',
      'stname1',
      'ramp_running_slope_total',
      'ramp_cross_slope',
      'ramp_width',
      'dws_conditions',
      'obstacles_ramp',
      'ponding',
    ].join(','),
    '$limit': '200',
  });

  try {
    const rows = await fetchPublicJson<NycRampRow[]>(`${NYC_RAMPS_URL}?${query}`);
    const assessed = rows.map(assessRamp);
    assessed.sort((a, b) => Number(a.compliant) - Number(b.compliant) || b.issues.length - a.issues.length);
    return {
      fetched_at: Date.now() / 1000,
      total: assessed.length,
      compliant: assessed.filter((ramp) => ramp.compliant).length,
      substandard: assessed.filter((ramp) => ramp.measured && !ramp.compliant).length,
      unverified: assessed.filter((ramp) => !ramp.measured).length,
      ramps: assessed.slice(0, 40),
    };
  } catch {
    return {
      ...fallbackRamps(stopId),
      error: 'NYC Open Data could not be reached for this stop.',
    };
  }
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
  const session = await refreshPublicDataSession();
  let result: unknown;
  if (path === '/session') result = session;
  else if (path === '/stations') result = stations;
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
    else if (resource === 'ramps') result = await publicRamps(stopId, Number(params.meters ?? 200));
    else if (resource === 'equipment') result = stationOutages(stopId);
    else result = equipmentByStation[stopId] ?? [];
  }
  return structuredClone(result) as T;
}
