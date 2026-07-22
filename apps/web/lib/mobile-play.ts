'use client';

type MobileDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type MobileElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

export function isTouchPlayDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Best-effort browser preparation for the mobile game. Android browsers generally
 * require fullscreen before allowing an orientation lock; iOS currently ignores
 * one or both APIs, so the play screen also has a hard portrait blocker.
 */
export async function enterMobilePlayMode(): Promise<void> {
  if (!isTouchPlayDevice()) return;

  const doc = document as MobileDocument;
  const root = document.documentElement as MobileElement;
  try {
    if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else await root.webkitRequestFullscreen?.();
    }
  } catch {
    // Fullscreen support varies by mobile browser. The orientation gate remains.
  }

  try {
    await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape');
  } catch {
    // Orientation lock is not available on iOS Safari and can be policy-blocked.
  }
}
