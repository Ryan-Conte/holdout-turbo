'use client';

import dynamic from 'next/dynamic';

const GameClient = dynamic(() => import('@/components/GameClient'), {
  ssr: false,
  loading: () => <div className="connect-overlay">LOADING…</div>,
});

export default function PlayPage() {
  return <GameClient />;
}
