import { supabase } from '../lib/supabase';

type Entry = { url: string; expiresAt: number };

const cache = new Map<string, Entry>();

const keyFor = (bucket: string, path: string, download?: string) =>
  `${bucket}::${path}::${download || ''}`;

export async function getSignedUrlCached(
  bucket: string,
  path: string,
  ttlSeconds: number,
  options?: { download?: string | true },
): Promise<string | null> {
  const downloadKey =
    typeof options?.download === 'string' ? options.download : options?.download ? '1' : '';
  const key = keyFor(bucket, path, downloadKey);
  const now = Date.now();
  const hit = cache.get(key);
  // Reuse a cached URL until the last 10% of its TTL to avoid expiry-at-click.
  if (hit && hit.expiresAt - now > ttlSeconds * 100) {
    return hit.url;
  }
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds, options?.download ? { download: options.download } : undefined);
  if (error || !data?.signedUrl) return null;
  cache.set(key, { url: data.signedUrl, expiresAt: now + ttlSeconds * 1000 });
  return data.signedUrl;
}

export function invalidateSignedUrl(bucket: string, path: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${bucket}::${path}::`)) cache.delete(key);
  }
}
