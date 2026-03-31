const { LruCache } = require('../lib/lru-cache');

class ChapterCache {
  constructor(maxEntries = 900) {
    this.cache = new LruCache(maxEntries);
  }

  buildKey(bookId, chapterNumber) {
    return `${String(bookId || '')}:${Number(chapterNumber || 0)}`;
  }

  get(bookId, chapterNumber) {
    return this.cache.get(this.buildKey(bookId, chapterNumber));
  }

  set(bookId, chapterNumber, chapterPayload) {
    this.cache.set(this.buildKey(bookId, chapterNumber), chapterPayload);
  }

  get size() {
    return this.cache.size;
  }
}

module.exports = {
  ChapterCache,
};
