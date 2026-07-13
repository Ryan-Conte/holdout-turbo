import { InventoryUpdate, ITEMS, ItemId, RECIPES, RecipeCat } from '@holdout/shared';
import { Tip, itemTip } from '@/components/Tooltip';
import { ItemIcon } from './ItemIcon';

const CRAFT_TABS: { cat: RecipeCat; label: string }[] = [
  { cat: 'survival', label: 'SURVIVAL' },
  { cat: 'medical', label: 'MEDICAL' },
  { cat: 'gear', label: 'GEAR' },
  { cat: 'build', label: 'BUILD' },
  { cat: 'smelt', label: 'SMELT' },
  { cat: 'forge', label: 'FORGE' },
];

const STATION_LABEL: Record<string, string> = {
  workbench: 'workbench',
  furnace: 'furnace',
  anvil: 'anvil',
};

interface CraftingPanelProps {
  inventory: InventoryUpdate;
  tab: RecipeCat;
  selectedRecipeId: string | null;
  queue: string[];
  countItem: (id: ItemId) => number;
  onSelectTab: (tab: RecipeCat) => void;
  onSelectRecipe: (id: string | null) => void;
  onEnqueue: (id: string, count?: number) => void;
  onClearQueue: () => void;
}

function hasStation(inventory: InventoryUpdate, station?: string): boolean {
  if (!station) return true;
  if (station === 'workbench') return inventory.nearWorkbench;
  if (station === 'furnace') return inventory.nearFurnace;
  if (station === 'anvil') return inventory.nearAnvil;
  return true;
}

export function CraftingPanel({
  inventory,
  tab,
  selectedRecipeId,
  queue,
  countItem,
  onSelectTab,
  onSelectRecipe,
  onEnqueue,
  onClearQueue,
}: CraftingPanelProps) {
  const canMake = (recipe: (typeof RECIPES)[number]) =>
    recipe.cost.every((cost) => countItem(cost.id) >= cost.qty) && hasStation(inventory, recipe.station);
  const recipes = RECIPES.filter((recipe) => recipe.cat === tab && hasStation(inventory, recipe.station));
  const hidden = RECIPES.filter((recipe) => recipe.cat === tab && !hasStation(inventory, recipe.station));
  const hiddenStations = [...new Set(hidden.map((recipe) => STATION_LABEL[recipe.station!]))].join(' / ');
  const selected = recipes.find((recipe) => recipe.id === selectedRecipeId) ?? recipes[0];
  const queuedCount = (id: string) => queue.filter((queuedId) => queuedId === id).length;

  return (
    <div className="panel craft-panel">
      <h3>
        CRAFTING
        <span className="sub">{queue.length > 0 && <>&#9203; {queue.length} queued &middot; </>}C to close</span>
      </h3>
      <div className="craft-tabs">
        {CRAFT_TABS.filter((craftTab) => {
          const categoryRecipes = RECIPES.filter((recipe) => recipe.cat === craftTab.cat);
          const stations = new Set(categoryRecipes.map((recipe) => recipe.station));
          if (stations.size !== 1 || !categoryRecipes[0]?.station) return true;
          return hasStation(inventory, categoryRecipes[0].station);
        }).map((craftTab) => (
          <button
            key={craftTab.cat}
            className={tab === craftTab.cat ? 'active' : ''}
            onClick={() => {
              onSelectTab(craftTab.cat);
              onSelectRecipe(null);
            }}
          >
            {craftTab.label}
          </button>
        ))}
      </div>
      <div className="craft-body">
        <div className="craft-col">
          <div className="craft-grid">
            {recipes.map((recipe) => {
              const available = canMake(recipe);
              const queued = queuedCount(recipe.id);
              return (
                <Tip key={recipe.id} tip={itemTip(recipe.out.id, recipe.out.qty)}>
                  <button
                    className={`craft-cell${selected?.id === recipe.id ? ' active' : ''}${available ? ' craftable' : ' locked'}`}
                    onClick={() => onSelectRecipe(recipe.id)}
                    onDoubleClick={() => available && onEnqueue(recipe.id)}
                  >
                    <ItemIcon id={recipe.out.id} size={28} />
                    {recipe.out.qty > 1 && <span className="cc-qty">&times;{recipe.out.qty}</span>}
                    {recipe.station && <span className="cc-station">&#9874;</span>}
                    {queued > 0 && <span className="queue-badge">{queued}</span>}
                  </button>
                </Tip>
              );
            })}
            {recipes.length === 0 && <div className="craft-empty">Nothing craftable by hand here.</div>}
          </div>
          {hidden.length > 0 && (
            <div className="craft-hidden">
              &#128274; {hidden.length} more recipe{hidden.length > 1 ? 's' : ''} at the {hiddenStations}
            </div>
          )}
        </div>
        <div className="craft-detail">
          {selected && (() => {
            const available = canMake(selected);
            const queued = queuedCount(selected.id);
            return (
              <>
                <div className="cd-head">
                  <ItemIcon id={selected.out.id} size={40} />
                  <div>
                    <b>{ITEMS[selected.out.id].name}</b>
                    {selected.out.qty > 1 && <span className="cd-qty"> &times;{selected.out.qty}</span>}
                  </div>
                </div>
                <div className="cd-desc">{ITEMS[selected.out.id].desc}</div>
                <div className="cd-req">REQUIRES</div>
                <div className="cd-costs">
                  {selected.cost.map((cost) => (
                    <div key={cost.id} className={countItem(cost.id) >= cost.qty ? 'have' : 'missing'}>
                      <ItemIcon id={cost.id} size={18} /> {ITEMS[cost.id].name}
                      <span className="cd-count">{countItem(cost.id)}/{cost.qty}</span>
                    </div>
                  ))}
                </div>
                <div className="craft-actions">
                  <button className="btn-primary craft-go" disabled={!available} onClick={() => onEnqueue(selected.id)}>
                    {available
                      ? queued > 0 ? `CRAFT (+${queued} queued)` : 'CRAFT'
                      : selected.station && !hasStation(inventory, selected.station)
                        ? `NEED ${STATION_LABEL[selected.station].toUpperCase()}`
                        : 'MISSING MATERIALS'}
                  </button>
                  <button className="btn-primary craft-go x5" disabled={!available} onClick={() => onEnqueue(selected.id, 5)}>
                    &times;5
                  </button>
                  {queue.length > 0 && <button className="craft-clear" title="Clear the craft queue" onClick={onClearQueue}>&#10005;</button>}
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
