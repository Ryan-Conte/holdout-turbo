import { ActionSnap, InventoryUpdate, ITEMS, ItemId } from '@holdout/shared';
import { ItemIcon } from './ItemIcon';

type TimedAction = ActionSnap & { until: number };

interface CookingPanelProps {
  inventory: InventoryUpdate;
  action: TimedAction | null;
  queue: number[];
  onQueueSlot: (slot: number) => void;
  onQueueAll: (slots: { slot: number; quantity: number }[]) => void;
  onClose: () => void;
}

export function CookingPanel({ inventory, action, queue, onQueueSlot, onQueueAll, onClose }: CookingPanelProps) {
  const rawSlots = inventory.inv.slots
    .map((item, slot) => ({ item, slot }))
    .filter((entry): entry is { item: { id: ItemId; qty: number }; slot: number } => !!entry.item && !!ITEMS[entry.item.id].raw);
  const cookingSlot = action?.kind === 'cook' ? action.slot : undefined;
  const queuedCount = (slot: number) => queue.filter((queuedSlot) => queuedSlot === slot).length;

  return (
    <div className="panel cook-panel">
      <h3>CAMPFIRE<span className="sub">click = cook 1 &middot; ESC to close</span></h3>
      {rawSlots.length === 0 ? (
        <div className="item-desc">Nothing raw to cook &mdash; hunt animals or catch fish, then come back.</div>
      ) : (
        <div className="cook-list">
          {rawSlots.map(({ item, slot }) => {
            const definition = ITEMS[item.id];
            const cooking = cookingSlot === slot;
            const queued = queuedCount(slot);
            return (
              <button
                key={slot}
                className={`cook-row${cooking ? ' cooking' : ''}${queued > 0 ? ' queued' : ''}`}
                onClick={() => queued + (cooking ? 1 : 0) < item.qty && onQueueSlot(slot)}
              >
                <ItemIcon id={item.id} size={28} />
                <span className="cook-name">{definition.name} &times;{item.qty}</span>
                <span className="cook-arrow">&rarr;</span>
                <ItemIcon id={definition.raw!} size={22} />
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
          <button onClick={() => onQueueAll(rawSlots.map(({ item, slot }) => ({ slot, quantity: item.qty })))}>
            {queue.length > 0 ? `COOKING... (${queue.length} queued)` : 'QUEUE EVERYTHING'}
          </button>
        )}
        <button onClick={onClose}>CLOSE</button>
      </div>
    </div>
  );
}
