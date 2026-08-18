import { useState, useEffect } from 'react';

// Fetches a portal's own slice of the data from the server instead of reading
// Firestore in the browser.
//
// ROLLOUT SWITCH
// --------------
// This is inert until VITE_PORTAL_API is set to '1' at build time. With the
// flag off, `enabled` is false and the portals keep their previous behaviour
// exactly, so deploying this code changes nothing in production until the
// backend (FIREBASE_SERVICE_ACCOUNT) is in place and the flag is flipped.
//
// If the endpoint answers 503 not_configured — flag on but service account
// missing — we surface `notConfigured` so the caller can fall back rather than
// showing an investor a broken screen.
export const PORTAL_API_ENABLED = import.meta.env.VITE_PORTAL_API === '1';

export function usePortalData(token) {
  const [state, setState] = useState({
    loading: PORTAL_API_ENABLED,
    data: null,
    error: null,
    notConfigured: false,
  });

  useEffect(() => {
    if (!PORTAL_API_ENABLED) return;
    if (!token) {
      setState({ loading: false, data: null, error: 'invalid_token', notConfigured: false });
      return;
    }

    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    // The token goes in the body, never the URL, so it stays out of access
    // logs, browser history and Referer headers.
    fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 503 && payload.error === 'not_configured') {
          setState({ loading: false, data: null, error: null, notConfigured: true });
          return;
        }
        if (!res.ok) {
          setState({ loading: false, data: null, error: payload.error || 'server_error', notConfigured: false });
          return;
        }
        setState({ loading: false, data: payload, error: null, notConfigured: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, data: null, error: 'network_error', notConfigured: false });
      });

    return () => { cancelled = true; };
  }, [token]);

  return { ...state, enabled: PORTAL_API_ENABLED && !state.notConfigured };
}

// True when the current URL is a portal route. Used by AppContext to skip its
// Firestore subscriptions entirely — without this the whole database still
// crosses the wire even though the portal no longer reads it.
export function isPortalRoute() {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  return hash.startsWith('#/portal/') || hash.startsWith('#/funcionario/');
}
