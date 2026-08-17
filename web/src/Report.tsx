/**
 * Rider-reported accessibility problems.
 *
 * The feed only knows what the MTA publishes. It does not know that the
 * elevator is running but the path to it is blocked, that a lift is filthy or
 * unusable, or that a station marked accessible has a gap no wheelchair can
 * cross. Riders know all of that immediately, and there is no structured way
 * for them to say so.
 *
 * This composes a proper report and hands it back to the rider to send. It does
 * NOT submit anywhere. Pretending otherwise would be the worst possible bug in
 * this particular app: someone reports a hazard, believes it is filed, and it
 * goes nowhere. So the form is explicit that it is not connected, shows exactly
 * what it produced, and explains the real-use handoff without pretending that
 * connection exists in this demonstration.
 */
import { useId, useRef, useState } from 'react';

import type { Station } from './api';
import { accessSummary } from './api';
import { StationCombobox } from './components';

const PROBLEM_TYPES = [
  { value: 'elevator_out', label: 'Elevator out of service and not listed' },
  { value: 'path_blocked', label: 'Accessible route blocked or obstructed' },
  { value: 'wrong_status', label: 'Station listed as accessible but is not' },
  { value: 'gap_or_boarding', label: 'Platform gap or boarding problem' },
  { value: 'other', label: 'Something else' },
] as const;

export function Report({ stations }: { stations: Station[] }) {
  const [station, setStation] = useState<Station | undefined>();
  const [problem, setProblem] = useState<string>('');
  const [details, setDetails] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draftChanged, setDraftChanged] = useState(false);

  const detailsId = useId();
  const errorId = useId();
  const outputRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const invalidateReport = () => {
    setError(null);
    if (!report) return;
    setReport(null);
    setCopied(false);
    setDraftChanged(true);
  };

  const compose = (event: React.FormEvent) => {
    event.preventDefault();

    if (!station || !problem) {
      const missing = [
        !station ? 'Choose the station where the problem is.' : '',
        !problem ? 'Choose what kind of problem it is.' : '',
      ].filter(Boolean);
      setError(missing.join(' '));
      setReport(null);
      requestAnimationFrame(() => {
        const selector = !station ? 'input[role="combobox"]' : 'input[type="radio"]';
        formRef.current?.querySelector<HTMLInputElement>(selector)?.focus();
      });
      return;
    }

    setError(null);
    setDraftChanged(false);
    const chosen = PROBLEM_TYPES.find((p) => p.value === problem)?.label ?? problem;
    const now = new Date();

    setReport(
      [
        'ACCESSIBILITY PROBLEM REPORT',
        '',
        `Station:    ${station.stop_name} (GTFS ${station.stop_id})`,
        `Lines:      ${station.routes.join(', ') || 'unknown'}`,
        `Problem:    ${chosen}`,
        `Observed:   ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} (New York)`,
        '',
        'Details:',
        details.trim() || '(none given)',
        '',
        'Published status at time of report:',
        `  ${accessSummary(station)} — ${station.reason || 'no reason recorded'}`,
      ].join('\n'),
    );
    setCopied(false);
    // Move focus to the composed report; it is the result of the action, and a
    // keyboard user should not have to go looking for it.
    requestAnimationFrame(() => outputRef.current?.focus());
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('Could not copy automatically. Select the text above and copy it manually.');
    }
  };

  return (
    <section aria-labelledby="report-heading">
      <h2 id="report-heading">Draft a problem report</h2>

      <div className="notice notice-plain" style={{ marginTop: '1rem' }}>
        <p>
          <strong>This demonstration is not connected to the MTA.</strong> In real use, this
          section would open the MTA reporting flow with your details ready to submit. Here, it
          only creates a report you can review and copy. Nothing is sent.
        </p>
      </div>

      <form ref={formRef} className="planner" onSubmit={compose} style={{ marginTop: '1.5rem' }}>
        <StationCombobox
          label="Which station"
          stations={stations}
          value={station}
          onChange={(next) => {
            invalidateReport();
            setStation(next);
          }}
        />

        <fieldset className="fieldset">
          <legend>What is wrong</legend>
          <div className="radios">
            {PROBLEM_TYPES.map((type) => (
              <label key={type.value} className="radio">
                <input
                  type="radio"
                  name="problem"
                  value={type.value}
                  checked={problem === type.value}
                  onChange={(e) => {
                    invalidateReport();
                    setProblem(e.target.value);
                  }}
                />
                <span>{type.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor={detailsId}>Details (optional)</label>
          <textarea
            id={detailsId}
            rows={4}
            value={details}
            onChange={(e) => {
              invalidateReport();
              setDetails(e.target.value);
            }}
            placeholder="Which entrance, which platform, how long it has been like this…"
          />
        </div>

        {error ? (
          <p className="notice notice-stop" role="alert" id={errorId}>
            {error}
          </p>
        ) : null}

        {draftChanged ? (
          <p className="snapshot-static" role="status">
            Report details changed. Write up the report again to update the draft.
          </p>
        ) : null}

        <div className="btn-row">
          <button type="submit" className="btn" aria-describedby={error ? errorId : undefined}>
            Write up my report
          </button>
        </div>
      </form>

      {report ? (
        <div className="report-out" ref={outputRef} tabIndex={-1} aria-label="Your composed report">
          <h3>Your report</h3>
          <pre className="report-text">{report}</pre>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy report'}
            </button>
          </div>
          <p className="sr-only" role="status">
            {copied ? 'Report copied to the clipboard.' : ''}
          </p>

          <h3 style={{ marginTop: '1.5rem' }}>What would happen in real use</h3>
          <p>
            The app would link directly to the MTA reporting flow and carry these details with
            you. That connection is intentionally disabled in this demonstration.
          </p>
        </div>
      ) : null}
    </section>
  );
}
