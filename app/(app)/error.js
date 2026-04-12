'use client';
import { useEffect } from 'react';

export default function AppError({ error, reset }) {
  useEffect(() => {
    console.error('[app error boundary]', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-sw-card border border-sw-border rounded-2xl p-6 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <div className="text-sw-text text-base font-bold mb-2">Something went wrong</div>
        <p className="text-sw-sub text-xs mb-4 break-words">
          {error?.message || 'An unexpected error occurred while loading this page.'}
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-lg bg-sw-blueD text-sw-blue text-sm font-semibold border border-sw-blue/20 min-h-[44px]"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 rounded-lg border border-sw-border text-sw-sub text-sm font-semibold min-h-[44px] flex items-center"
          >
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
