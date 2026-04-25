'use client';

import React, { Component, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  eventId: string | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, eventId: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    const eventId = Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: info.componentStack ?? 'unavailable',
        },
      },
      tags: {
        errorBoundary: 'dashboard-root',
      },
    });
    this.setState({ eventId });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, eventId: null, copied: false });
  };

  handleCopyId = async () => {
    if (!this.state.eventId) return;
    try {
      await navigator.clipboard.writeText(this.state.eventId);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Clipboard denied or unavailable — no-op.
    }
  };

  render() {
    if (this.state.hasError) {
      const { eventId, copied } = this.state;
      const shortId = eventId ? eventId.slice(0, 8) : null;
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(255,107,107,0.12)', border: '1px solid rgba(255,107,107,0.25)' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red-solid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-[var(--text-primary)] text-lg font-semibold" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Something went wrong
          </h2>
          <p className="text-[var(--text-muted)] text-sm max-w-sm">
            An unexpected error occurred. Your data is safe. Try the actions below — if the problem persists, email support with the reference ID.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                background: 'rgba(0,229,160,0.12)',
                color: 'var(--accent-emerald-text)',
                border: '1px solid rgba(0,229,160,0.25)',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Reload page
            </button>
            <a
              href={`mailto:support@kiloenergies.com?subject=App%20error${shortId ? `%20(${shortId})` : ''}&body=${encodeURIComponent(
                `I hit an error in the Kilo app.\n\nReference ID: ${eventId ?? 'unavailable'}\nWhat I was doing: \n`,
              )}`}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Email support
            </a>
          </div>

          {shortId && (
            <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>Reference:</span>
              <button
                onClick={this.handleCopyId}
                className="font-mono px-2 py-1 rounded hover:bg-white/5 transition-colors"
                title="Copy reference ID"
              >
                {shortId}…
              </button>
              {copied && <span className="text-[var(--accent-emerald-text)]">Copied</span>}
            </div>
          )}

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="mt-4 text-xs text-[var(--accent-red-text)]/70 max-w-lg overflow-auto text-left p-3 rounded-lg bg-red-500/5">
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
