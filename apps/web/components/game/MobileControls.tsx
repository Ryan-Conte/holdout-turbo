'use client';

import { PointerEvent, useEffect, useRef, useState } from 'react';
import { enterMobilePlayMode } from '@/lib/mobile-play';

export interface TouchVector {
  x: number;
  y: number;
}

interface VirtualStickProps {
  label: string;
  hint: string;
  onChange: (vector: TouchVector, active: boolean) => void;
}

function VirtualStick({ label, hint, onChange }: VirtualStickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [vector, setVector] = useState<TouchVector>({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  useEffect(() => () => onChange({ x: 0, y: 0 }, false), [onChange]);

  const update = (event: PointerEvent<HTMLDivElement>) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.36);
    const rawX = event.clientX - (rect.left + rect.width / 2);
    const rawY = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > radius ? radius / distance : 1;
    const next = { x: (rawX * scale) / radius, y: (rawY * scale) / radius };
    setVector(next);
    onChange(next, true);
  };

  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerRef.current) return;
    pointerRef.current = null;
    setActive(false);
    setVector({ x: 0, y: 0 });
    onChange({ x: 0, y: 0 }, false);
  };

  return (
    <div className={`mobile-stick${active ? ' active' : ''}`}>
      <div
        ref={baseRef}
        className="mobile-stick-base"
        role="application"
        aria-label={`${label} joystick`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (pointerRef.current !== null) return;
          pointerRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          setActive(true);
          update(event);
        }}
        onPointerMove={(event) => {
          if (event.pointerId === pointerRef.current) update(event);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <span className="mobile-stick-ring" />
        <span
          className="mobile-stick-knob"
          style={{ transform: `translate(${vector.x * 34}px, ${vector.y * 34}px)` }}
        />
      </div>
      <b>{label}</b>
      <small>{hint}</small>
    </div>
  );
}

interface MobileControlsProps {
  connected: boolean;
  gameplayLocked: boolean;
  panelOpen: boolean;
  guest: boolean;
  muted: boolean;
  rotatingBuild: boolean;
  onMove: (vector: TouchVector, active: boolean) => void;
  onAim: (vector: TouchVector, active: boolean) => void;
  onInteract: () => void;
  onReload: () => void;
  onHeal: () => void;
  onGear: () => void;
  onCraft: () => void;
  onMap: () => void;
  onSkills: () => void;
  onSocial: () => void;
  onChat: () => void;
  onSound: () => void;
  onPause: () => void;
  onClosePanel: () => void;
}

export function MobileControls({
  connected,
  gameplayLocked,
  panelOpen,
  guest,
  muted,
  rotatingBuild,
  onMove,
  onAim,
  onInteract,
  onReload,
  onHeal,
  onGear,
  onCraft,
  onMap,
  onSkills,
  onSocial,
  onChat,
  onSound,
  onPause,
  onClosePanel,
}: MobileControlsProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const tap = (action: () => void) => () => {
    setMoreOpen(false);
    action();
  };

  return (
    <>
      <div className="mobile-orientation-gate" role="dialog" aria-modal="true" aria-labelledby="mobile-landscape-title">
        <div className="mobile-rotate-phone" aria-hidden="true"><i /></div>
        <p>MOBILE DEPLOYMENT</p>
        <h1 id="mobile-landscape-title">ROTATE TO LANDSCAPE</h1>
        <span>HOLDOUT needs the wider field of view and both thumbs available.</span>
        <button type="button" onClick={() => void enterMobilePlayMode()}>ENTER LANDSCAPE</button>
      </div>

      <div className={`mobile-controls${gameplayLocked ? ' gameplay-locked' : ''}`} aria-hidden={!connected}>
        {connected && !gameplayLocked && (
          <>
            <VirtualStick label="MOVE" hint="EDGE TO RUN" onChange={onMove} />
            <div className="mobile-action-cluster" aria-label="Game actions">
              <button type="button" className="mobile-action heal" onPointerDown={onHeal}><b>+</b><span>HEAL</span></button>
              <button type="button" className="mobile-action interact" onPointerDown={onInteract}><b>E</b><span>USE</span></button>
              <button type="button" className="mobile-action reload" onPointerDown={onReload}><b>R</b><span>{rotatingBuild ? 'ROTATE' : 'RELOAD'}</span></button>
            </div>
            <VirtualStick label="AIM" hint="HOLD TO FIRE" onChange={onAim} />
          </>
        )}

        {connected && (
          <div className="mobile-utility-wrap">
            {panelOpen ? (
              <button type="button" className="mobile-panel-close" onClick={tap(onClosePanel)}>BACK TO ZONE</button>
            ) : (
              <>
                <div className="mobile-utility-bar">
                  <button type="button" onClick={tap(onGear)}>GEAR</button>
                  <button type="button" onClick={tap(onCraft)}>CRAFT</button>
                  <button type="button" onClick={tap(onMap)}>MAP</button>
                  <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>MORE</button>
                </div>
                {moreOpen && (
                  <div className="mobile-more-menu">
                    <button type="button" onClick={tap(onSkills)}>SKILLS</button>
                    {!guest && <button type="button" onClick={tap(onSocial)}>SOCIAL</button>}
                    {!guest && <button type="button" onClick={tap(onChat)}>CHAT</button>}
                    <button type="button" onClick={tap(onSound)}>{muted ? 'SOUND ON' : 'SOUND OFF'}</button>
                    <button type="button" onClick={tap(onPause)}>MENU</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
