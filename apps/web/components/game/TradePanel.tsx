import { InventoryUpdate, ItemId, TradeOpen } from '@holdout/shared';
import { Tip, itemTip } from '@/components/Tooltip';
import { itemDef } from '@/lib/runtime-gameplay';
import { ItemIcon } from './ItemIcon';

export type TradeTab = 'buy' | 'sell' | 'jobs';

interface TradePanelProps {
  trade: TradeOpen;
  inventory: InventoryUpdate;
  tab: TradeTab;
  selectedBuyId: ItemId | null;
  selectedSellSlot: number | null;
  onSelectTab: (tab: TradeTab) => void;
  onSelectBuy: (id: ItemId) => void;
  onSelectSell: (slot: number) => void;
  onBuy: (id: ItemId, quantity: number) => void;
  onSell: (slot: number, quantity: number) => void;
  onClaimQuest: (id: number) => void;
  onClose: () => void;
}

export function TradePanel({
  trade,
  inventory,
  tab,
  selectedBuyId,
  selectedSellSlot,
  onSelectTab,
  onSelectBuy,
  onSelectSell,
  onBuy,
  onSell,
  onClaimQuest,
  onClose,
}: TradePanelProps) {
  const buyList = trade.stock.filter((entry) => entry.buy > 0);
  const sellable = inventory.inv.slots
    .map((item, slot) => ({
      item,
      slot,
      entry: item ? trade.stock.find((stock) => stock.id === item.id && stock.sell > 0) : undefined,
    }))
    .filter((row): row is {
      item: { id: ItemId; qty: number };
      slot: number;
      entry: { id: ItemId; buy: number; sell: number };
    } => !!row.item && !!row.entry);
  const openJobs = trade.quests.filter((quest) => !quest.claimed).length;
  const selectedBuy = buyList.find((entry) => entry.id === selectedBuyId) ?? buyList[0];
  const selectedSell = sellable.find((row) => row.slot === selectedSellSlot) ?? sellable[0];

  return (
    <div className="panel trade-panel">
      <h3>{trade.tier === 2 ? <>&#9760; BLACK MARKET</> : 'TRADER'}<span className="sub">{trade.money} credits</span></h3>
      <div className="craft-tabs">
        <button className={tab === 'buy' ? 'active' : ''} onClick={() => onSelectTab('buy')}>BUY</button>
        <button className={tab === 'sell' ? 'active' : ''} onClick={() => onSelectTab('sell')}>
          SELL{sellable.length > 0 ? ` (${sellable.length})` : ''}
        </button>
        <button className={tab === 'jobs' ? 'active' : ''} onClick={() => onSelectTab('jobs')}>
          JOBS{openJobs > 0 ? ` (${openJobs})` : ''}
        </button>
      </div>

      {tab === 'buy' && (
        <div className="craft-body">
          <div className="craft-grid trade-grid">
            {buyList.map((entry) => (
              <Tip key={entry.id} tip={itemTip(entry.id)}>
                <button
                  className={`craft-cell${selectedBuy?.id === entry.id ? ' active' : ''}${inventory.money >= entry.buy ? ' craftable' : ' locked'}`}
                  onClick={() => onSelectBuy(entry.id)}
                  onDoubleClick={() => inventory.money >= entry.buy && onBuy(entry.id, 1)}
                >
                  <ItemIcon id={entry.id} size={28} />
                  <span className="cc-price">{entry.buy}</span>
                </button>
              </Tip>
            ))}
          </div>
          <div className="craft-detail">
            {selectedBuy && (
              <>
                <div className="cd-head"><ItemIcon id={selectedBuy.id} size={40} /><div><b>{itemDef(selectedBuy.id).name}</b></div></div>
                <div className="cd-desc">{itemDef(selectedBuy.id).desc}</div>
                <div className="cd-costs">
                  <div className={inventory.money >= selectedBuy.buy ? 'have' : 'missing'}>
                    PRICE <span className="cd-count">{selectedBuy.buy} cr</span>
                  </div>
                  <div className="have">YOUR CREDITS <span className="cd-count">{trade.money}</span></div>
                </div>
                <div className="craft-actions">
                  <button className="btn-primary craft-go" disabled={inventory.money < selectedBuy.buy} onClick={() => onBuy(selectedBuy.id, 1)}>BUY 1</button>
                  <button className="btn-primary craft-go x5" disabled={inventory.money < selectedBuy.buy * 5} onClick={() => onBuy(selectedBuy.id, 5)}>&times;5</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'sell' && (
        <div className="craft-body">
          <div className="craft-grid trade-grid">
            {sellable.map(({ item, slot, entry }) => (
              <Tip key={slot} tip={itemTip(item.id, item.qty)}>
                <button
                  className={`craft-cell craftable${selectedSell?.slot === slot ? ' active' : ''}`}
                  onClick={() => onSelectSell(slot)}
                  onDoubleClick={() => onSell(slot, 1)}
                >
                  <ItemIcon id={item.id} size={28} />
                  {item.qty > 1 && <span className="cc-qty">&times;{item.qty}</span>}
                  <span className="cc-price">{entry.sell}</span>
                </button>
              </Tip>
            ))}
            {sellable.length === 0 && <div className="craft-empty">Nothing in your backpack this trader wants.</div>}
          </div>
          <div className="craft-detail">
            {selectedSell && (
              <>
                <div className="cd-head">
                  <ItemIcon id={selectedSell.item.id} size={40} />
                  <div><b>{itemDef(selectedSell.item.id).name}</b><span className="cd-qty"> &times;{selectedSell.item.qty}</span></div>
                </div>
                <div className="cd-desc">{itemDef(selectedSell.item.id).desc}</div>
                <div className="cd-costs">
                  <div className="have">EACH <span className="cd-count">{selectedSell.entry.sell} cr</span></div>
                  <div className="have">WHOLE STACK <span className="cd-count">{selectedSell.entry.sell * selectedSell.item.qty} cr</span></div>
                </div>
                <div className="craft-actions">
                  <button className="btn-primary craft-go" onClick={() => onSell(selectedSell.slot, 1)}>SELL 1</button>
                  <button className="btn-primary craft-go x5" onClick={() => onSell(selectedSell.slot, selectedSell.item.qty)}>ALL</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="jobs">
          {trade.quests.map((quest) => (
            <div className="job-row" key={quest.def.id}>
              <div className="job-body">
                <b>{quest.def.name}</b>
                <div className="job-desc">
                  {quest.def.desc || (quest.def.kind === 'kill'
                    ? `Kill ${quest.def.count} ${quest.def.target}s`
                    : `Bring ${quest.def.count} ${itemDef(quest.def.target).name}`)}
                  {' '}&middot; {quest.progress}/{quest.def.count}
                  {' '}&middot; reward {quest.def.rewardMoney}cr{quest.def.rewardItem ? ` + ${itemDef(quest.def.rewardItem).name}` : ''}
                </div>
              </div>
              {quest.claimed
                ? <span className="job-done">DONE</span>
                : <button disabled={!quest.done} onClick={() => onClaimQuest(quest.def.id)}>CLAIM</button>}
            </div>
          ))}
          {trade.quests.length === 0 && <div className="craft-empty">No work for you here yet &mdash; finish earlier jobs to unlock more.</div>}
        </div>
      )}

      <div className="item-actions"><button onClick={onClose}>CLOSE</button></div>
    </div>
  );
}
