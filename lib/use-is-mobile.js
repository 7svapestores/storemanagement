'use client';
import { useState, useEffect } from 'react';

// Matches the breakpoint the Daily Sales page uses to swap its table for
// cards, so every view in the app switches to a phone layout at the same
// width. Starts false so server-rendered markup is the desktop layout and
// the client corrects it on mount.
const MOBILE_QUERY = '(max-width: 767px)';

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    // Rotating a phone should re-lay-out, not leave a stale layout behind.
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  return isMobile;
}
