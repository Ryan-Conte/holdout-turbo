import { InventoryUpdate } from '@holdout/shared';

interface PauseOverlayProps {
  inHideout: boolean;
  inSafeZone: boolean;
  muted: boolean;
  onResume: () => void;
  onToggleSound: () => void;
  onReturnToMenu: () => void;
  onLogOut: () => void;
}

export function PauseOverlay({
  inHideout,
  inSafeZone,
  muted,
  onResume,
  onToggleSound,
  onReturnToMenu,
  onLogOut,
}: PauseOverlayProps) {
  return (
    <div className="death-overlay esc-menu">
      <h2>PAUSED</h2>
      <p className="death-stats">The zone keeps moving while you stand still.</p>
      {!inHideout && !inSafeZone && (
        <p className="esc-warn">
          &#9888; You are out in the open &mdash; if you leave now your body stays in the zone for 60 seconds and can be killed and looted.
        </p>
      )}
      <button className="btn-primary" onClick={onResume}>RESUME</button>
      <button className="btn-primary secondary" onClick={onToggleSound}>{muted ? <>&#128263; SOUND OFF</> : <>&#128266; SOUND ON</>}</button>
      <button className="btn-primary secondary" onClick={onReturnToMenu}>RETURN TO MENU</button>
      <button className="btn-primary secondary" onClick={onLogOut}>LOG OUT</button>
    </div>
  );
}

interface DeathOverlayProps {
  killer: string;
  inventory: InventoryUpdate | null;
  onRespawn: () => void;
  onLogOut: () => void;
}

export function DeathOverlay({ killer, inventory, onRespawn, onLogOut }: DeathOverlayProps) {
  return (
    <div className="death-overlay">
      <h2>YOU DIED</h2>
      <p>Killed by {killer}. Your gear was dropped where you fell.</p>
      <p className="death-stats">You respawn with only your fists &mdash; stash, credits and skills are safe.</p>
      {inventory && <p className="death-stats">&#9760; {inventory.kills} kills &middot; {inventory.deaths} deaths &middot; {inventory.money} cr</p>}
      <button className="btn-primary" onClick={onRespawn}>RESPAWN</button>
      <button className="btn-primary secondary" onClick={onLogOut}>LOG OUT</button>
    </div>
  );
}
