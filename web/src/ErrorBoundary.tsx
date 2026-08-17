/**
 * Catches render errors so a bug produces a readable message instead of a
 * blank page.
 *
 * A white screen is the worst possible failure mode here: there is nothing for
 * a screen reader to announce, no indication anything went wrong, and no way to
 * recover — and the users least able to work around it are the ones this app
 * exists for. The fallback is a real alert with a way out.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: '2rem 1rem', maxWidth: '60ch', margin: '0 auto' }}>
        <div className="notice notice-stop" role="alert">
          <h2>
            <span aria-hidden="true">✕</span> The app hit an unexpected error
          </h2>
          <p>
            Nothing you did caused this. Reloading usually clears it — if it does not, the
            details below help track it down.
          </p>
          <p>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </p>
          <p style={{ fontSize: '0.8125rem', opacity: 0.85 }}>
            <code>{error.message}</code>
          </p>
        </div>
      </div>
    );
  }
}
