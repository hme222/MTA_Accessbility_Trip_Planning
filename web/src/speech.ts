/**
 * Read-aloud, built on the browser's own speech synthesis.
 *
 * This is not a screen reader and does not try to be one. It serves people who
 * do not run assistive tech but still find reading a list of departures hard:
 * low vision without a screen reader, dyslexia, cognitive fatigue, or simply
 * standing on a platform without a free hand.
 *
 * Two rules follow from that:
 *
 *   1. It never speaks on its own. Anyone running a screen reader would then
 *      hear two voices at once, which is worse than silence. Every utterance
 *      starts from a button press.
 *   2. It is always interruptible. `stop()` cancels immediately, and the
 *      control that started it turns into the control that ends it.
 */

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Speak `text`, replacing anything already queued.
 *
 * `onDone` fires on completion, cancellation, or error, so a caller can always
 * return its button to the idle state.
 */
export function speak(text: string, onDone?: () => void): void {
  if (!speechSupported() || !text.trim()) {
    onDone?.();
    return;
  }

  // Chrome keeps a queue across calls; without this a second press stacks up
  // behind the first rather than replacing it.
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  // Slightly under default. Station names and times are dense, and the point
  // is comprehension, not speed.
  utterance.rate = 0.95;
  utterance.pitch = 1;

  utterance.onend = () => onDone?.();
  utterance.onerror = () => onDone?.();

  window.speechSynthesis.speak(utterance);
}

export function stop(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return speechSupported() && window.speechSynthesis.speaking;
}
