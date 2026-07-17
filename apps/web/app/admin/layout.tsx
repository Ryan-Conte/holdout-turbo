import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { RevisionControls } from '@/components/admin/RevisionControls';

const sections = [
  ['map', 'World'], ['terrain', 'Terrain'], ['resources', 'Resources'], ['mobs', 'Mobs'], ['animations', 'Animations'], ['sounds', 'Sounds'], ['items', 'Items'], ['recipes', 'Crafting'],
  ['loot', 'Loot'], ['traders', 'Traders'], ['blocks', 'Blocks'], ['sprites', 'Pixel art'],
  ['quests', 'Quests'], ['servers', 'Servers'], ['settings', 'Settings'],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  if (!user) redirect('/');
  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <Link className="admin-brand" href="/admin/map"><b>HOLDOUT</b><span>ENGINE</span></Link>
        <div className="admin-user"><span>ADMIN SESSION</span><b>{user.name}</b><Link href="/">EXIT</Link></div>
      </header>
      <nav className="admin-nav">{sections.map(([slug, label]) => <Link key={slug} href={`/admin/${slug}`}>{label}</Link>)}</nav>
      <RevisionControls />
      <main className="admin-main">{children}</main>
    </div>
  );
}
