import type { EngineContentKind } from '@holdout/shared';

export interface EditorMeta {
  revision: number;
  publishedRevision: number;
}

interface ContentResponse<T> {
  draft: T;
  revision: number;
  publishedRevision: number;
  error?: string;
}

export async function loadContentDraft<T>(kind: EngineContentKind): Promise<{ draft: T; meta: EditorMeta }> {
  const response = await fetch(`/api/admin/content/${kind}`, { cache: 'no-store' });
  const data = await response.json() as ContentResponse<T>;
  if (!response.ok) throw new Error(data.error ?? `Could not load ${kind}`);
  return {
    draft: data.draft,
    meta: { revision: data.revision, publishedRevision: data.publishedRevision },
  };
}

export async function persistContentDraft(
  kind: EngineContentKind,
  draft: unknown,
  publish: boolean,
  setStatus: (status: string) => void,
  setMeta: (meta: EditorMeta) => void,
): Promise<void> {
  setStatus(`Validating ${kind}...`);
  const response = await fetch(`/api/admin/content/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  });
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error ?? 'Save failed');
    return;
  }

  if (!publish) {
    setMeta({ revision: data.revision, publishedRevision: data.publishedRevision });
    setStatus(`Draft revision ${data.revision} saved`);
    return;
  }

  setStatus(`Publishing ${kind}...`);
  const liveResponse = await fetch(`/api/admin/content/${kind}`, { method: 'POST' });
  const liveData = await liveResponse.json();
  if (!liveResponse.ok) {
    setStatus(liveData.error ?? 'Publish failed');
    return;
  }
  setMeta({ revision: data.revision, publishedRevision: liveData.publishedRevision });
  setStatus(`Revision ${liveData.publishedRevision} is live`);
}
