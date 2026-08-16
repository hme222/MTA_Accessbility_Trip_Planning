/**
 * Project presentation.
 *
 * Sits below the footer as a native <details>: out of the way of anyone here to
 * plan a trip, discoverable for anyone here to evaluate the work. Collapsed by
 * default, keyboard-operable, and announced correctly without any ARIA of our
 * own.
 *
 * Structured the way a technical reviewer reads: the problem, the insight that
 * makes it tractable, what was built, the trade-offs behind it, what the data
 * showed, and what is honestly still missing.
 */

const DECISIONS = [
  {
    title: 'A value that means two opposite things',
    tension:
      'GTFS and the MTA both use 2, and they disagree. In GTFS it means boarding is impossible. To the MTA it means partially accessible.',
    call:
      'Write both, in separate columns. Consumers read the GTFS column and get correct GTFS semantics; the MTA value is preserved verbatim in a non-standard column that spec-compliant readers ignore. Collapsing them would tell every trip planner that a usable station was unusable.',
  },
  {
    title: 'Expressing something the spec has no word for',
    tension:
      'GTFS has no value for “accessible in one direction.” The obvious move is to invent one, which no other consumer would understand.',
    call:
      'Use what the spec already has. The feed carries directional child platforms, so each takes the rating for its own direction. Partial accessibility falls out of standard GTFS, and any router doing an ordinary stop lookup gets it right without knowing this project exists.',
  },
  {
    title: 'Whether to hide trips a rider probably cannot take',
    tension:
      'Filtering to accessible trips only is the obvious product decision, and a strict reading of the data supports it.',
    call:
      'Warn, never block. Riders have workarounds the feed cannot see — a companion, a transfer, a bus leg, a different exit. Times Sq to Union Sq returns thousands of trips by default and zero under strict filtering. “No service” is a worse answer than “here are your options, with caveats.”',
  },
  {
    title: 'What to do where the data goes quiet',
    tension:
      'The elevator feed does not say which direction an elevator serves, and GTFS does not say whether the connection inside a station is step-free. Guessing would look more precise.',
    call:
      'Be conservative and label the uncertainty. A blocking outage takes out both directions. A walk between two complexes carries an explicit “verify before relying on it.” The failure mode is a longer route, not a rider stranded on a platform they cannot leave.',
  },
  {
    title: 'How much to trust a name',
    tension:
      'Three datasets, three naming conventions, and station complexes that appear under several names at once. Fuzzy matching would have joined them in an afternoon.',
    call:
      'Join on published identifiers or do not ship. Both sources key to GTFS parent stations exactly — 496 of 496 for the ADA baseline, 193 of 193 for equipment. A fuzzy match that is 98% right is a station that silently lies to someone.',
  },
];

const STACK = [
  ['Data layer', 'Python + pandas. Resolves accessibility per platform, folds in live outages, emits an augmented GTFS feed any standard router can consume.'],
  ['API', 'FastAPI over an in-memory feed. 2.3M stop_times rows held in memory behind a reader seam, so the analysis code is unchanged — direct trips in ~0.3s, transfers in ~2s.'],
  ['Client', 'React + Vite. WCAG AAA contrast in both themes, ARIA combobox, live regions, full keyboard support.'],
  ['Sources', 'MTA static GTFS, Subway Stations (data.ny.gov), Elevator & Escalator API, bus alerts. No API keys, no scraping, no name matching.'],
];

const OUTCOMES = [
  { num: '140/496', cap: 'Stations fully ADA accessible — 28% of the system' },
  { num: '8', cap: 'Platforms a rider can reach but cannot leave' },
  { num: '22,937', cap: 'Trips carrying a return hazard, from those 8 platforms' },
  { num: '~30%', cap: 'Of all scheduled trips affected' },
];

export function About() {
  return (
    <details className="about">
      <summary className="about-summary">
        <span aria-hidden="true">▸</span> About this project — problem, approach, and results
      </summary>

      <div className="about-body">
        <section className="about-section">
          <p className="about-kicker">The problem</p>
          <h3>Accessibility is published per station. Elevators serve platforms.</h3>
          <p className="about-lede">
            Every transit planner treats wheelchair accessibility as one flag per station. But an
            elevator serves a platform, not a building — so a station can be accessible in one
            direction and not the other. A rider arrives on the accessible platform and finds no
            accessible way to board the train home.
          </p>
        </section>

        <section className="about-section">
          <p className="about-kicker">The insight</p>
          <h3>Eight platforms put a return-trip hazard on a third of the system.</h3>
          <p className="about-lede">
            Resolving accessibility down to the platform makes a failure mode visible that a
            per-station flag cannot represent at all. It is not an edge case: because a trip
            inherits the risk of every stop it calls at, eight platforms place a hazard on 22,937
            of 77,236 scheduled trips.
          </p>
          <div className="outcome">
            {OUTCOMES.map((o) => (
              <div key={o.cap}>
                <div className="num">{o.num}</div>
                <div className="cap">{o.cap}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="about-section">
          <p className="about-kicker">What it does</p>
          <h3>Warns, never blocks — and always offers a way forward.</h3>
          <ul className="about-list">
            <li>
              <strong>Directional accessibility</strong> for all 496 stations, resolved per
              platform and reflecting live elevator outages.
            </li>
            <li>
              <strong>Return-trip warnings.</strong> The one thing no other planner tells you:
              whether you can get back.
            </li>
            <li>
              <strong>Accessible alternatives.</strong> When a station does not work, nearby ones
              that do — preferring stations on the same line, one press to swap.
            </li>
            <li>
              <strong>Transfers.</strong> One change of train, judged across four platforms
              instead of two, since a change is where accessibility breaks.
            </li>
            <li>
              <strong>Why a station is closed.</strong> Not “EL218 out of service” but what it
              serves and when it returns — the detail that decides whether to wait or reroute.
            </li>
            <li>
              <strong>Planned outages</strong> so a trip can be planned around a closure rather
              than discovering it on the platform.
            </li>
            <li>
              <strong>Buses.</strong> Every MTA bus is wheelchair accessible. Where the subway is
              28% accessible, the bus network is effectively 100%.
            </li>
          </ul>
        </section>

        <section className="about-section">
          <p className="about-kicker">How it is built</p>
          <h3>Four public feeds, joined on identifiers that already match.</h3>
          <dl className="about-stack">
            {STACK.map(([label, detail]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="about-section">
          <p className="about-kicker">The trade-offs</p>
          <h3>Every interesting choice here was a trade-off, not a feature.</h3>
          <p className="about-lede">
            The engineering was mostly joins and lookups. What took the time was deciding what the
            data was allowed to say — and, more often, what it was not allowed to decide on a
            rider&rsquo;s behalf.
          </p>
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
        </section>

        <section className="about-section">
          <p className="about-kicker">Limitations</p>
          <h3>What this does not do.</h3>
          <ul className="about-list">
            <li>
              <strong>One transfer, not two.</strong> Journeys needing two changes are not
              modeled.
            </li>
            <li>
              <strong>In-station connections are inferred.</strong> GTFS does not record whether
              the path between platforms is step-free. Same-complex changes treat both platforms
              working as sufficient — stated as an inference, not a fact.
            </li>
            <li>
              <strong>The feed is a snapshot.</strong> Outages change hourly. The app shows how
              old its data is rather than implying it is live.
            </li>
            <li>
              <strong>Schedules, not realtime.</strong> The GTFS-RT feeds are mapped and reachable
              but not yet wired in.
            </li>
          </ul>
        </section>

        <section className="about-section">
          <p className="about-kicker">Accessibility of the app itself</p>
          <h3>Verified, not asserted.</h3>
          <p className="about-lede">
            Every color pair is computed rather than eyeballed: both themes clear WCAG AAA (7:1)
            for text and AA (3:1) for control boundaries. White text failed on five MTA line
            bullets, so those take dark text — the published hues are never altered, because the
            hue is the recognition cue a rider actually uses. Root font size follows the
            reader&rsquo;s browser setting instead of overriding it, the station picker is a full
            ARIA combobox, and auto-refresh updates data in place rather than reloading the page
            and discarding your work.
          </p>
        </section>
      </div>
    </details>
  );
}
