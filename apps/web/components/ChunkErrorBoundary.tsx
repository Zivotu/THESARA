'use client';

import React from 'react';

type State = { hasError: boolean; error?: Error | null };

class ChunkErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  componentDidCatch(error: unknown) {
    if (typeof window !== 'undefined' && error instanceof Error) {
      if (/ChunkLoadError/i.test(error.name)) {
        window.location.reload();
        return;
      }
      // Non-chunk errors: show a minimal fallback to avoid blank page
      // and surface the error in dev tools.
      console.error('UI error:', error);
      this.setState({ hasError: true, error });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 m-4 rounded border border-rose-200 bg-rose-50 text-rose-800">
          <p className="font-semibold">Došlo je do greške u sučelju.</p>
          <pre className="mt-2 text-xs whitespace-pre-wrap">{this.state.error?.message}</pre>
          <button
            className="mt-3 px-3 py-1 rounded bg-rose-600 text-white"
            onClick={() => window.location.reload()}
          >
            Osvježi stranicu
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ChunkErrorBoundary;
