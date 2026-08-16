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
 *   - It is collapsed by default. Loading map tiles costs data and battery,
 *     and a rider who does not want a map should not pay for one.
 */
import { useEffect, useId, useRef, useState } from 'react';
import L from 'leaflet';

import type { Station } from './api';
import { accessLevel, accessSummary } from './api';

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

export function TripMap({ origin, destination }: { origin: Station; destination: Station }) {
  const [open, setOpen] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const regionId = useId();

  const summary =
    `Map showing ${origin.stop_name}, which is ${accessSummary(origin).toLowerCase()}, ` +
    `and ${destination.stop_name}, which is ${accessSummary(destination).toLowerCase()}. ` +
    `The same information is listed in text below the map.`;

  useEffect(() => {
    if (!open || !nodeRef.current || mapRef.current) return;
    if (origin.lat == null || destination.lat == null) return;

    const map = L.map(nodeRef.current, {
      // No keyboard handlers: the map must not become a tab stop that traps
      // arrow keys away from the page.
      keyboard: false,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const a = L.latLng(origin.lat, origin.lon!);
    const b = L.latLng(destination.lat, destination.lon!);

    L.marker(a, { icon: pin(origin, 'From'), keyboard: false }).addTo(map);
    L.marker(b, { icon: pin(destination, 'To'), keyboard: false }).addTo(map);
    L.polyline([a, b], { color: '#0039A6', weight: 4, opacity: 0.75, dashArray: '6 6' }).addTo(map);

    map.fitBounds(L.latLngBounds([a, b]).pad(0.35));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [open, origin, destination]);

  if (origin.lat == null || destination.lat == null) return null;

  return (
    <div className="map-block">
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">◉</span> {open ? 'Hide map' : 'Show map'}
      </button>

      <div id={regionId} hidden={!open}>
        {/* aria-hidden on the tile container: its contents are hundreds of
            unlabeled image tiles and control divs, none of which mean anything
            spoken. The description above carries the content. */}
        <div className="map-frame" role="img" aria-label={summary}>
          <div ref={nodeRef} className="map-canvas" aria-hidden="true" />
        </div>

        {/* The map's content, as text. Not a fallback — it is always present. */}
        <ul className="map-legend">
          <li>
            <span className="map-swatch" style={{ background: MARKER[accessLevel(origin)].fill }} aria-hidden="true" />
            <strong>From:</strong> {origin.stop_name} — {accessSummary(origin)}
          </li>
          <li>
            <span
              className="map-swatch"
              style={{ background: MARKER[accessLevel(destination)].fill }}
              aria-hidden="true"
            />
            <strong>To:</strong> {destination.stop_name} — {accessSummary(destination)}
          </li>
        </ul>
        <p className="map-note">
          The dashed line is direct distance between stations, not the route the train takes.
        </p>
      </div>
    </div>
  );
}
