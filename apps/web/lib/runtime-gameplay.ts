import {
  ITEMS,
  RECIPES,
  type RuntimeGameplayContent,
  type RuntimeItemDef,
  type RuntimeItemRegistry,
  type RuntimeRecipe,
} from '@holdout/shared';

const fallbackItems = ITEMS as unknown as RuntimeItemRegistry;
let activeItems: RuntimeItemRegistry = fallbackItems;
let activeRecipes: RuntimeRecipe[] = RECIPES;
let activeVersion = 'fallback';

export function applyRuntimeGameplay(content: RuntimeGameplayContent | null | undefined): boolean {
  if (!content || !content.items || !Array.isArray(content.recipes)) return false;
  if (content.version === activeVersion && activeItems === content.items) return false;
  activeItems = { ...fallbackItems, ...content.items };
  activeRecipes = content.recipes;
  activeVersion = content.version;
  return true;
}

export function itemDef(id: string | null | undefined): RuntimeItemDef {
  if (id && activeItems[id]) return activeItems[id];
  return {
    id: id ?? 'unknown',
    name: id || 'Unknown item',
    kind: 'material',
    kg: 0,
    stack: 1,
    desc: 'This item is not defined by the active server content revision.',
  };
}

export function runtimeItems(): RuntimeItemRegistry {
  return activeItems;
}

export function runtimeRecipes(): RuntimeRecipe[] {
  return activeRecipes;
}

export function runtimeGameplayVersion(): string {
  return activeVersion;
}
