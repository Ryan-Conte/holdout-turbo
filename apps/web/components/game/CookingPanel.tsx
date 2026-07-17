import { ActionSnap, InventoryUpdate, ItemId, StationOpen } from '@holdout/shared';
import { itemDef } from '@/lib/runtime-gameplay';
import { ItemIcon } from './ItemIcon';

type TimedAction = ActionSnap & { until: number };

interface CookingPanelProps {
  inventory: InventoryUpdate;
  action: TimedAction | null;
  queue: number[];
  station: StationOpen;
  onQueueSlot: (slot: number) => void;
  onQueueAll: (slots: { slot: number; quantity: number }[]) => void;
  onAddFuel: (quantity: number) => void;
  onClose: () => void;
}

export function CookingPanel({ inventory, action, queue, station, onQueueSlot, onQueueAll, onAddFuel, onClose }: CookingPanelProps) {
  const rawSlots = inventory.inv.slots
    .map((item, slot) => ({ item, slot }))
    .filter((entry): entry is { item: { id: ItemId; qty: number }; slot: number } => !!entry.item && !!itemDef(entry.item.id).raw);
  const cookingSlot = action?.kind === 'cook' ? action.slot : undefined;
  const queuedCount = (slot: number) => queue.filter((queuedSlot) => queuedSlot === slot).length;
  const fuel = station.fuel ?? 0;
  const maxFuel = station.maxFuel ?? 0;
  const wood = inventory.inv.slots.reduce((count, item) => count + (item?.id === 'wood' ? item.qty : 0), 0);
  const reservedFuel = queue.length + (cookingSlot !== undefined ? 1 : 0);
  const freeFuel = Math.max(0, fuel - reservedFuel);
  const queueable = (() => {
    let remaining = freeFuel;
    const result: { slot: number; quantity: number }[] = [];
    for (const { item, slot } of rawSlots) {
      if (remaining <= 0) break;
      const already = queuedCount(slot) + (cookingSlot === slot ? 1 : 0);
      const quantity = Math.min(remaining, Math.max(0, item.qty - already));
      if (quantity > 0) result.push({ slot, quantity: already + quantity });
      remaining -= quantity;
    }
    return result;
  })();

  return (
    <div className="panel cook-panel">
      <h3>CAMPFIRE<span className="sub">click = cook 1 &middot; ESC to close</span></h3>
      <div className={`station-fuel${fuel <= 0 ? ' empty' : ''}`}>
        <div><b>{fuel > 0 ? 'FIRE LIT' : 'FIRE OUT'}</b><span>{fuel}/{maxFuel} heat &middot; {wood} wood carried</span></div>
        <div className="station-fuel-track"><i style={{ width: `${maxFuel > 0 ? fuel / maxFuel * 100 : 0}%` }} /></div>
        <button disabled={wood <= 0 || fuel >= maxFuel} onClick={() => onAddFuel(1)}>+1 WOOD</button>
        <button disabled={wood <= 0 || fuel >= maxFuel} onClick={() => onAddFuel(5)}>+5</button>
      </div>
      {rawSlots.length === 0 ? (
        <div className="item-desc">Nothing raw to cook &mdash; hunt animals or catch fish, then come back.</div>
      ) : (
        <div className="cook-list">
          {rawSlots.map(({ item, slot }) => {
            const definition = itemDef(item.id);
            const cooking = cookingSlot === slot;
            const queued = queuedCount(slot);
            return (
              <button
                key={slot}
                className={`cook-row${cooking ? ' cooking' : ''}${queued > 0 ? ' queued' : ''}`}
                disabled={freeFuel <= 0}
                onClick={() => freeFuel > 0 && queued + (cooking ? 1 : 0) < item.qty && onQueueSlot(slot)}
              >
                <ItemIcon id={item.id} size={28} />
                <span className="cook-name">{definition.name} &times;{item.qty}</span>
                <span className="cook-arrow">&rarr;</span>
                <ItemIcon id={definition.raw! as ItemId} size={22} />
                {cooking && action && (
                  <span className="cook-prog">
                    <span key={action.until} style={{ animationDuration: `${action.ms}ms` }} />
                  </span>
                )}
                {queued > 0 && <span className="queue-badge">{queued}</span>}
                {!cooking && queued === 0 && <span className="cook-hint">COOK +1</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="item-actions">
        {rawSlots.length > 0 && (
          <button disabled={queueable.length === 0} onClick={() => onQueueAll(queueable)}>
            {queue.length > 0 ? `COOKING... (${queue.length} queued)` : 'QUEUE EVERYTHING'}
          </button>
        )}
        <button onClick={onClose}>CLOSE</button>
      </div>
    </div>
  );
}
