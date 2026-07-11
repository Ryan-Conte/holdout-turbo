'use client';

// Custom steel-styled tooltips — replaces the browser's default title="" bubbles.
// <Tip tip={<node/>}>{anything}</Tip> — the wrapper uses display:contents so it
// never disturbs grid/flex layouts; the bubble renders in a portal above the UI.

import { ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';
import { ITEMS, ItemId, skillLevel } from '@holdout/shared';

export function Tip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!tip) return <>{children}</>;
  return (
    <span
      style={{ display: 'contents' }}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
      onMouseDown={() => setPos(null)}
    >
      {children}
      {pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="tip-bubble"
            style={{
              left: Math.min(pos.x + 14, window.innerWidth - 240),
              top: Math.max(8, pos.y - 10),
            }}
          >
            {tip}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Rich item card: name, description and the stats that matter. */
export function itemTip(id: ItemId, qty = 1): ReactNode {
  const def = ITEMS[id];
  const w = def.weapon;
  const m = def.melee;
  return (
    <>
      <div className="tip-title">{def.name}{qty > 1 ? ` ×${qty}` : ''}</div>
      <div className="tip-desc">{def.desc}</div>
      <div className="tip-stats">
        {w && (
          <>
            <span>DMG {w.damage}{w.pellets > 1 ? `×${w.pellets}` : ''}</span>
            <span>RPM {Math.round(60000 / w.fireRateMs)}</span>
            <span>MAG {w.magSize}</span>
            <span>RANGE {w.range}</span>
            {w.noise !== undefined && w.noise < 200 && <span className="tip-good">QUIET</span>}
          </>
        )}
        {m && !w && <span>DMG {m.damage}</span>}
        {def.armor && <span>-{Math.round(def.armor.reduction * 100)}% DMG ({def.armor.piece})</span>}
        {def.heal && <span className="tip-good">+{def.heal} HP</span>}
        {def.food && <span className="tip-good">+{def.food} FOOD</span>}
        {def.drink && <span className="tip-good">+{def.drink} H2O</span>}
        {def.place && <span>PLACEABLE</span>}
        <span className="tip-dim">{def.kg} kg</span>
      </div>
    </>
  );
}

export { skillLevel };
