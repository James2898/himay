const CACHE_NAME = "himay-stems-v1";

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
    const cache = await caches.open("himay-stems-v1");
    const response = await cache.match(url);

    if (response && response.ok) {
      const blob = await response.blob();
      // Verify the blob actually has data
      if (blob.size > 100) {
        return URL.createObjectURL(blob);
      }
    }
  } catch (e) {
    console.warn("Cache access error, falling back to CDN", e);
  }

  return url;
};
