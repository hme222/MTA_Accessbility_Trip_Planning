/**
 * Periodic refresh of live data.
 *
 * Deliberately NOT `location.reload()`. Elevator status genuinely does go stale
 * within minutes, so refreshing it is right — but reloading the document to get
 * it would throw away the user's selections, their results, and any report they
 * were part-way through writing, cut off a screen reader mid-sentence, and drop
 * focus back at the top of the page. For an app whose users may take several
 * minutes to fill in a form, that is a trap, and WCAG 2.2.1 (Timing Adjustable)
 * exists because of it.
 *
 * So: refetch the data in place, leave the DOM the user is working in alone,
 * never move focus, and let anyone switch it off.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const REFRESH_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'auto-refresh';

export function useAutoRefreshSetting(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  });

  const set = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
    } catch {
      /* private browsing; the setting just will not persist */
    }
  }, []);

  return [enabled, set];
}

/**
 * Call `onRefresh` every `intervalMs` while `enabled`.
 *
 * Pauses when the tab is hidden — polling a backgrounded tab wastes the
 * device's battery and the API's time — and refreshes once on return so the
 * data a user comes back to is current.
 */
export function useAutoRefresh(onRefresh: () => void, enabled: boolean, intervalMs = REFRESH_MS) {
  // Kept in a ref so a changing callback identity does not restart the timer.
  const saved = useRef(onRefresh);
  useEffect(() => {
    saved.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    let timer = window.setInterval(() => {
      if (!document.hidden) saved.current();
    }, intervalMs);

    const onVisible = () => {
      if (document.hidden) return;
      saved.current();
      // Restart the cycle from the moment of return, so someone coming back
      // does not get a second refresh a few seconds later.
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (!document.hidden) saved.current();
      }, intervalMs);
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs]);
}
