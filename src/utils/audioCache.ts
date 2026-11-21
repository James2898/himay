export const CACHE_NAME = "himay-stems-v1";

export class StemUrlManager {
  private activeUrls: Set<string> = new Set();

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
    this.activeUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.activeUrls.clear();
  }
}

export const stemUrlManager = new StemUrlManager();

export const cacheSongStems = async (stems: Record<string, string>) => {
  if (typeof window === "undefined" || !window.caches) {
    throw new Error(
      "Offline caching requires HTTPS or localhost (CacheStorage is disabled over insecure HTTP).",
    );
  }

  const cache = await caches.open(CACHE_NAME);
  const urls = Object.values(stems);

  // Download uncached stems in parallel
  await Promise.all(
    urls.map(async (url) => {
      const response = await cache.match(url);
      if (!response) {
        console.log(`Caching: ${url}`);
        await cache.add(url);
      }
    }),
  );
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
