import { InventoryUpdate } from '@holdout/shared';

interface PauseOverlayProps {
  guest: boolean;
  inHideout: boolean;
  inSafeZone: boolean;
  muted: boolean;
  onResume: () => void;
  onToggleSound: () => void;
  onReturnToMenu: () => void;
  onLogOut: () => void;
}

export function PauseOverlay({
  guest,
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
          &#9888; You are out in the open &mdash; your body remains vulnerable for 60 seconds. Reconnect before the timer ends or the zone claims your carried gear.
        </p>
      )}
      <button className="btn-primary" onClick={onResume}>RESUME</button>
      <button className="btn-primary secondary" onClick={onToggleSound}>{muted ? <>&#128263; SOUND OFF</> : <>&#128266; SOUND ON</>}</button>
      <button className="btn-primary secondary" onClick={onReturnToMenu}>{guest ? 'LEAVE GUEST RAID' : 'RETURN TO MENU'}</button>
      {!guest && <button className="btn-primary secondary" onClick={onLogOut}>LOG OUT</button>}
    </div>
  );
}

interface DeathOverlayProps {
  guest: boolean;
  killer: string;
  inventory: InventoryUpdate | null;
  onRespawn: () => void;
  onLogOut: () => void;
}

export function DeathOverlay({ guest, killer, inventory, onRespawn, onLogOut }: DeathOverlayProps) {
  return (
    <div className="death-overlay">
      <h2>YOU DIED</h2>
      <p>Killed by {killer}. Your gear was dropped where you fell.</p>
      <p className="death-stats">{guest
        ? 'Guest progress is temporary. Redeploy empty-handed or register to unlock persistent progression.'
        : 'You wake at home with only your fists — stash, credits and skills are safe.'}</p>
      {inventory && <p className="death-stats">&#9760; {inventory.kills} kills &middot; {inventory.deaths} deaths &middot; {inventory.money} cr</p>}
      <button className="btn-primary" onClick={onRespawn}>{guest ? 'REDEPLOY AS GUEST' : 'WAKE AT HOME'}</button>
      <button className="btn-primary secondary" onClick={onLogOut}>{guest ? 'LEAVE GUEST RAID' : 'LOG OUT'}</button>
    </div>
  );
}
