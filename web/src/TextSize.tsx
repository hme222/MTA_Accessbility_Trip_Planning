/**
 * In-app text size control.
 *
 * Browser zoom already works, and so does the browser's own font-size setting —
 * but plenty of people never find either, and on a shared or locked-down device
 * they may not be able to change them at all. A visible control costs little
 * and removes that dependency.
 *
 * The critical detail is that this **multiplies** the reader's own base size
 * rather than replacing it. Setting `fontSize = '20px'` would silently discard
 * a browser preference someone deliberately set — the exact mistake the
 * stylesheet avoids by using `font-size: 100%` on the root. A percentage keeps
 * both: their base, scaled by their choice here.
 */
import { useEffect, useState } from 'react';

const STEPS = [
  { label: 'A', percent: 100, name: 'Default text size' },
  { label: 'A', percent: 120, name: 'Large text' },
  { label: 'A', percent: 145, name: 'Larger text' },
] as const;

const STORAGE_KEY = 'text-size';

export function TextSize() {
  const [percent, setPercent] = useState(() => {
    if (typeof window === 'undefined') return 100;
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return STEPS.some((s) => s.percent === stored) ? stored : 100;
  });

  useEffect(() => {
    // Percentage, not px: the root stays relative to whatever the browser's
    // own font-size setting is.
    document.documentElement.style.fontSize = `${percent}%`;
    try {
      localStorage.setItem(STORAGE_KEY, String(percent));
    } catch {
      /* private browsing; the choice just will not persist */
    }
  }, [percent]);

  const current = STEPS.find((s) => s.percent === percent) ?? STEPS[0];

  return (
    <div className="text-size" role="group" aria-label="Text size">
      <span className="text-size-label" aria-hidden="true">
        Text
      </span>
      {STEPS.map((step, index) => (
        <button
          key={step.percent}
          type="button"
          className="text-size-btn"
          aria-pressed={step.percent === percent}
          aria-label={`${step.name} (${step.percent}%)`}
          // The three A's differ only in size, which is the point visually but
          // meaningless to a screen reader — hence the written label above.
          style={{ fontSize: `${0.8 + index * 0.22}rem` }}
          onClick={() => setPercent(step.percent)}
        >
          {step.label}
        </button>
      ))}
      <span className="sr-only" role="status">
        {`Text size ${current.name.toLowerCase()}, ${percent} percent.`}
      </span>
    </div>
  );
}
