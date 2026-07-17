'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ENGINE_CONTENT_KINDS } from '@holdout/shared';

interface RevisionOption {
  id?: number;
  revision?: number;
  name?: string;
  active?: boolean;
  published?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const contentKinds = new Set<string>(ENGINE_CONTENT_KINDS);
const stagingUrl = process.env.NEXT_PUBLIC_STAGING_GAME_URL ?? '';

export function RevisionControls() {
  const pathname = usePathname();
  const slug = pathname.split('/').filter(Boolean).at(-1) ?? '';
  const isMap = slug === 'map';
  const supported = isMap || contentKinds.has(slug);
  const [revisions, setRevisions] = useState<RevisionOption[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!supported) { setRevisions([]); return; }
    let cancelled = false;
    const endpoint = isMap ? '/api/admin/map' : `/api/admin/content/${slug}`;
    void fetch(endpoint, { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (cancelled || !response.ok) return;
      const history: RevisionOption[] = isMap ? data.revisions ?? [] : data.history ?? [];
      setRevisions(history);
      const rollback = history.find((entry) => isMap ? !entry.active : entry.revision !== data.publishedRevision);
      setSelected(rollback ? String(isMap ? rollback.id : rollback.revision) : '');
    });
    return () => { cancelled = true; };
  }, [isMap, slug, supported]);

  const chosen = useMemo(() => revisions.find((entry) => String(isMap ? entry.id : entry.revision) === selected), [isMap, revisions, selected]);

  if (!supported) return null;

  const rollback = async () => {
    if (!chosen) return;
    const label = isMap ? `map #${chosen.id} (${chosen.name})` : `${slug} revision ${chosen.revision}`;
    if (!window.confirm(`Restore ${label} live? The current revision remains in history.`)) return;
    setStatus('Restoring revision...');
    const response = await fetch(isMap ? '/api/admin/map' : `/api/admin/content/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isMap ? { id: chosen.id } : { revision: chosen.revision, publish: true }),
    });
    const data = await response.json();
    if (!response.ok) { setStatus(data.error ?? 'Rollback failed'); return; }
    setStatus('Revision restored live. Reloading editor...');
    window.location.reload();
  };

  const launchStaging = () => {
    if (!stagingUrl) return;
    window.location.href = `/play?channel=staging&server=${encodeURIComponent(stagingUrl.replace(/\/$/, ''))}`;
  };

  return (
    <div className="revision-controls">
      <span>REVISION SAFETY</span>
      <select value={selected} onChange={(event) => setSelected(event.target.value)} aria-label="Revision to restore">
        <option value="">Choose history...</option>
        {revisions.map((entry) => {
          const id = isMap ? entry.id : entry.revision;
          const live = isMap ? entry.active : entry.published;
          return <option key={id} value={id}>r{id}{entry.name ? ` · ${entry.name}` : ''}{live ? ' · published' : ''}</option>;
        })}
      </select>
      <button disabled={!chosen} onClick={() => void rollback()}>ROLL BACK LIVE</button>
      <button className="staging" disabled={!stagingUrl} onClick={launchStaging} title={stagingUrl ? 'Join the isolated draft-content server' : 'Set NEXT_PUBLIC_STAGING_GAME_URL to enable'}>OPEN STAGING RAID</button>
      <small>{status || (stagingUrl ? 'Draft content is isolated from live worlds.' : 'Configure a staging server to raid-test drafts.')}</small>
    </div>
  );
}
