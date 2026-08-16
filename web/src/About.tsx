/**
 * Case study, shown beneath the app itself.
 *
 * Collapsed by default: someone here to plan a trip should not have to scroll
 * past a project write-up to reach it. Rendered as a real <details> element so
 * the open/closed state is native, keyboard-operable, and announced correctly
 * without any ARIA of our own.
 */

const DECISIONS = [
  {
    title: 'Where to put a value that means two different things',
    tension:
      'GTFS and the MTA both use 2, and they disagree. In GTFS it means boarding is impossible. To the MTA it means partially accessible. One column cannot hold both.',
    call:
      'Write both, separately. Consumers read the GTFS column and get correct GTFS semantics; the MTA value is preserved verbatim in a non-standard column that spec-compliant readers ignore. Collapsing them would tell every trip planner that a usable station was unusable.',
  },
  {
    title: 'Whether to express something the spec has no word for',
    tension:
      'GTFS has no value for “accessible in one direction.” The obvious move is to invent one, which no other consumer would understand.',
    call:
      'Use what the spec already has. The feed carries directional child platforms, so each takes the rating for its own direction. Partial accessibility falls out of standard GTFS, and any router doing an ordinary stop lookup gets it right without knowing this project exists.',
  },
  {
    title: 'Whether to hide trips a rider probably cannot take',
    tension:
      'Filtering to accessible trips only is the obvious product decision, and it is what a strict reading of the data supports.',
    call:
      'Warn, never block. Riders have workarounds the feed cannot see — a companion, a transfer, a bus leg, a different exit. Times Sq to Union Sq returns thousands of trips by default and zero under strict filtering, and “no service” is a worse answer than “here are your options, with caveats.”',
  },
  {
    title: 'What to do when the data cannot answer the question',
    tension:
      'The elevator feed does not say which direction of travel an elevator serves. Guessing would produce a more precise-looking answer most of the time.',
    call:
      'Be conservative and say so. A blocking outage takes out both directions at that station. It overstates the damage, but the failure mode is a longer route — not a rider stranded on a platform they cannot leave.',
  },
  {
    title: 'How much to trust a name',
    tension:
      'Three datasets, three naming conventions, and station complexes that appear under several names at once. Fuzzy matching would have joined them quickly.',
    call:
      'Join on published identifiers or do not ship. Both sources key to GTFS parent stations exactly — 496 of 496 for the ADA baseline, 193 of 193 for equipment. A fuzzy match that is 98% right is a station that silently lies to someone.',
  },
];

const OUTCOMES = [
  { num: '28%', cap: 'Of stations are fully ADA accessible — 140 of 496' },
  { num: '8', cap: 'Platforms reachable but not returnable' },
  { num: '22,937', cap: 'Trips carrying a return-trip hazard, from those 8 platforms alone' },
  { num: '100%', cap: 'Of MTA buses are wheelchair accessible' },
];

export function About() {
  return (
    <details className="about">
      <summary className="about-summary">
        <span aria-hidden="true">▸</span> About this project — the decisions behind it
      </summary>

      <div className="about-body">
        <p className="about-lede">
          The engineering was mostly joins and lookups. What took the time was deciding what the
          data was allowed to say — and, more often, what it was not allowed to decide on a
          rider&rsquo;s behalf.
        </p>

        <h3>The trade-offs</h3>
        <div className="decisions">
          {DECISIONS.map((d) => (
            <article className="decision" key={d.title}>
              <h4>{d.title}</h4>
              <div className="tension">
                <span className="label">The tension</span>
                <p>{d.tension}</p>
              </div>
              <div className="call">
                <span className="label">The call</span>
                <p>{d.call}</p>
              </div>
            </article>
          ))}
        </div>

        <h3>What the data turned out to say</h3>
        <div className="outcome">
          {OUTCOMES.map((o) => (
            <div key={o.cap}>
              <div className="num">{o.num}</div>
              <div className="cap">{o.cap}</div>
            </div>
          ))}
        </div>

        <div className="notice notice-plain" style={{ marginTop: '1.5rem' }}>
          <p>
            The finding that justified the project: a hazard affecting roughly a third of all
            scheduled trips traces back to just eight platforms. It is invisible to any model
            that treats accessibility as one flag per station, and it disappears the moment you
            resolve to the platform instead.
          </p>
          <p style={{ marginTop: '0.6rem' }}>
            <strong>The honest limitation:</strong> this plans single-train trips only. Because
            the accessible network is sparse, many real journeys need a transfer — which makes
            transfer support the next thing that matters, not a nice-to-have.
          </p>
        </div>
      </div>
    </details>
  );
}
