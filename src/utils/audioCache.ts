const CACHE_NAME = "himay-stems-v1";

export class StemUrlManager {
  private activeUrls = new Set<string>();

  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.activeUrls.add(url);
    return url;
  }

  revoke(url: string): void {
    if (this.activeUrls.delete(url)) {
      URL.revokeObjectURL(url);
    }
  }

  revokeAll(): void {
    for (const url of this.activeUrls) {
      URL.revokeObjectURL(url);
    }
    this.activeUrls.clear();
  }

  get urls(): string[] {
    return Array.from(this.activeUrls);
  }
}

export const stemUrlManager = new StemUrlManager();

export const cacheSongStems = async (stems: Record<string, string>) => {
  const cache = await caches.open(CACHE_NAME);
  const urls = Object.values(stems);

  // Only download if not already in cache
  for (const url of urls) {
    const response = await cache.match(url);
    if (!response) {
      console.log(`Caching: ${url}`);
      await cache.add(url);
    }
  }
};

export const getCachedUrl = async (url: string): Promise<string> => {
  if (typeof window === "undefined" || !window.caches) return url;

  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);

    if (response && response.ok) {
      const blob = await response.blob();
      // Verify the blob actually has data
      if (blob.size > 100) {
        return stemUrlManager.create(blob);
      }
    }
  } catch (e) {
    console.warn("Cache access error, falling back to CDN", e);
  }

  return url;
};
