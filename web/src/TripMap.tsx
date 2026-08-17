/**
 * Map of the two stations and the line between them.
 *
 * A map is the one part of this app that cannot be made equally useful to
 * everyone, so it is built as an *enhancement* and never as the only path to
 * anything. Every fact it shows — which stations, how far apart, whether each
 * is accessible — is already stated in text elsewhere on the page, and the map
 * itself carries a text summary for anyone who cannot use it.
 *
 * Concretely:
 *   - The container is `role="img"` with a written description, so assistive
 *     tech gets the summary instead of a pile of unlabeled tile divs.
 *   - Keyboard users are not dropped into a pan/zoom trap they must escape;
 *     the map is removed from the tab order and the same information sits in
 *     focusable text below it.
 *   - It appears only after a location is selected, when spatial confirmation
 *     has a job to do. The same content remains available as text below it.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';

import type { Station } from './api';
import { accessLevel, accessSummary, stopKindLabel } from './api';

// Marker colors match the severity language used everywhere else: a station is
// shown as accessible, partially accessible, or not.
const MARKER = {
  full: { fill: '#005D27', label: 'ADA accessible' },
  partial: { fill: '#6B4900', label: 'partially accessible' },
  none: { fill: '#95201A', label: 'not accessible' },
} as const;

function pin(station: Station, role: string): L.DivIcon {
  const level = accessLevel(station);
  const { fill } = MARKER[level];
  const glyph = level === 'full' ? '✓' : level === 'partial' ? '↺' : '✕';

  return L.divIcon({
    className: 'map-pin-wrap',
    html:
      `<span class="map-pin" style="background:${fill}">` +
      `<span class="map-pin-glyph">${glyph}</span></span>` +
      `<span class="map-pin-label">${role}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export function TripMap({ origin, destination }: { origin?: Station; destination?: Station }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const first = origin ?? destination;

  const summary = origin && destination
    ? `Map showing ${origin.stop_name}, which is ${accessSummary(origin).toLowerCase()}, ` +
      `and ${destination.stop_name}, which is ${accessSummary(destination).toLowerCase()}. ` +
      `The same information is listed in text below the map.`
    : first
      ? `Map showing ${first.stop_name}, a ${stopKindLabel(first).toLowerCase()}, which is ${accessSummary(first).toLowerCase()}. ` +
        `Choose the other end of the trip to see both. The same information is listed in text below the map.`
      : '';

  useEffect(() => {
    if (!nodeRef.current || mapRef.current || !first || first.lat == null) return;

    const map = L.map(nodeRef.current, {
      // No keyboard handlers: the map must not become a tab stop that traps
      // arrow keys away from the page.
      keyboard: false,
      scrollWheelZoom: false,
      zoomControl: false,
      attributionControl: false,
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '',
    }).addTo(map);

    const points: L.LatLng[] = [];
    if (origin?.lat != null) {
      const a = L.latLng(origin.lat, origin.lon!);
      points.push(a);
      L.marker(a, { icon: pin(origin, 'From'), keyboard: false }).addTo(map);
    }

    if (destination?.lat != null) {
      const b = L.latLng(destination.lat, destination.lon!);
      points.push(b);
      L.marker(b, { icon: pin(destination, 'To'), keyboard: false }).addTo(map);
    }

    if (points.length === 2) {
      L.polyline(points, { color: '#0039A6', weight: 4, opacity: 0.75, dashArray: '6 6' }).addTo(map);
      map.fitBounds(L.latLngBounds(points).pad(0.35));
    } else {
      // One place chosen: centre on it at a scale that shows the streets
      // around the entrance, which is what a rider is checking.
      map.setView(points[0], 16);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [origin, destination, first]);

  if (!first || first.lat == null) return null;

  return (
    <div className="map-block">
      <h3>Selected locations</h3>
      {/* aria-hidden on the tile container: its contents are hundreds of
          unlabeled image tiles and control divs, none of which mean anything
          spoken. The description above carries the content. */}
      <div className="map-frame" role="img" aria-label={summary}>
        <div ref={nodeRef} className="map-canvas" aria-hidden="true" />
      </div>
      <p className="map-attribution">
        Map tiles ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors (opens in a new tab)
        </a>
      </p>

      {/* The map's content, as text. Not a fallback — it is always present. */}
      <ul className="map-legend">
        {origin ? (
          <li>
            <span className="map-swatch" style={{ background: MARKER[accessLevel(origin)].fill }} aria-hidden="true" />
            <span><strong>From:</strong> {origin.stop_name} · {stopKindLabel(origin)} · {accessSummary(origin)}</span>
          </li>
        ) : null}
        {destination ? (
          <li>
            <span
              className="map-swatch"
              style={{ background: MARKER[accessLevel(destination)].fill }}
              aria-hidden="true"
            />
            <span><strong>To:</strong> {destination.stop_name} · {stopKindLabel(destination)} · {accessSummary(destination)}</span>
          </li>
        ) : (
          <li className="map-pending">Choose a destination.</li>
        )}
      </ul>
      {origin && destination ? (
        <p className="map-note">
          The dashed line connects the selected locations. It is not a turn-by-turn transit or walking path.
        </p>
      ) : null}
    </div>
  );
}
