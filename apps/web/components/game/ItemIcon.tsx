import { ITEM_INDEX, ITEM_SHEET_ORDER } from '@/game/sprites';
import { itemDef } from '@/lib/runtime-gameplay';
import { runtimeAssetFrame, runtimePixelVisible, runtimeVisualAsset } from '@/lib/runtime-visuals';

export function ItemIcon({ id, size = 28 }: { id: string; size?: number }) {
  const definition = itemDef(id);
  const asset = runtimeVisualAsset(definition.spriteId ?? `item:${id}`);
  const pixels = runtimeAssetFrame(asset);
  const index = ITEM_INDEX[id as keyof typeof ITEM_INDEX];
  const scale = size / 16;

  // Published engine art is authoritative for every item, including IDs that
  // also exist in the compatibility sheet.
  if (asset && pixels) {
    return (
      <svg className="item-icon item-icon-runtime" width={size} height={size} viewBox={`0 0 ${asset.width} ${asset.height}`} shapeRendering="crispEdges" aria-label={definition.name}>
        {pixels.map((color, pixel) => runtimePixelVisible(color)
          ? <rect key={pixel} x={pixel % asset.width} y={Math.floor(pixel / asset.width)} width="1" height="1" fill={color} />
          : null)}
      </svg>
    );
  }

  if (index === undefined) {
    return <span className="item-icon item-icon-missing" style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * .45)) }}>?</span>;
  }

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
