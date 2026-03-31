class LruCache {
  constructor(maxEntries = 500) {
    this.maxEntries = Math.max(10, Number(maxEntries) || 500);
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return null;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    this.trim();
  }

  has(key) {
    return this.map.has(key);
  }

  trim() {
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

module.exports = {
  LruCache,
};
