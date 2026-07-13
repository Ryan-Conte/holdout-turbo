import { notFound } from 'next/navigation';
import type { EngineContentKind } from '@holdout/shared';
import { QuestsEditor, ServersEditor } from '@/components/admin/OperationsEditors';
import { ContentEditor } from '@/components/admin/ContentEditor';
import { PixelEditor } from '@/components/admin/PixelEditor';
import { MapStudio } from '@/components/admin/MapStudio';
import { MobEditor } from '@/components/admin/MobEditor';
import { AnimationEditor } from '@/components/admin/AnimationEditor';
import { ResourceEditor } from '@/components/admin/ResourceEditor';
import { SoundEditor } from '@/components/admin/SoundEditor';
import { BlockEditor } from '@/components/admin/BlockEditor';
import { TerrainEditor } from '@/components/admin/TerrainEditor';
import { RecipeEditor, TraderEditor } from '@/components/admin/EconomyEditors';
import { ItemEditor } from '@/components/admin/ItemEditor';
import { LootEditor } from '@/components/admin/LootEditor';

const contentKinds = new Set<EngineContentKind>(['settings']);

export default async function EnginePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug === 'map') return <MapStudio />;
  if (slug === 'mobs') return <MobEditor />;
  if (slug === 'animations') return <AnimationEditor />;
  if (slug === 'resources') return <ResourceEditor />;
  if (slug === 'terrain') return <TerrainEditor />;
  if (slug === 'items') return <ItemEditor />;
  if (slug === 'recipes') return <RecipeEditor />;
  if (slug === 'loot') return <LootEditor />;
  if (slug === 'traders') return <TraderEditor />;
  if (slug === 'sounds') return <SoundEditor />;
  if (slug === 'blocks') return <BlockEditor />;
  if (slug === 'quests') return <QuestsEditor />;
  if (slug === 'servers') return <ServersEditor />;
  if (slug === 'sprites') return <PixelEditor />;
  if (contentKinds.has(slug as EngineContentKind)) return <ContentEditor kind={slug as Exclude<EngineContentKind, 'sprites'>} />;
  notFound();
}
