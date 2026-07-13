import { ItemId } from '@holdout/shared';
import { ITEM_INDEX, ITEM_SHEET_ORDER } from '@/game/sprites';

export function ItemIcon({ id, size = 28 }: { id: ItemId; size?: number }) {
  const index = ITEM_INDEX[id] ?? 0;
  const scale = size / 16;

  return (
    <span
      className="item-icon"
      style={{
        width: size,
        height: size,
        backgroundImage: 'url(/sprites/items.png)',
        backgroundPosition: `-${index * 16 * scale}px 0`,
        backgroundSize: `${ITEM_SHEET_ORDER.length * 16 * scale}px ${16 * scale}px`,
      }}
    />
  );
}
