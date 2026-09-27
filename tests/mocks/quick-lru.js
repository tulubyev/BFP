/**
 * CommonJS stand-in for quick-lru (ESM-only) under jest. geotiff's CommonJS build require()s it;
 * Node ≥ 20.19 loads ESM through require(), jest's module runtime does not. Only what
 * geotiff's BlockedSource uses: a Map with maxSize and onEviction.
 */
class QuickLRU extends Map {
  constructor({ maxSize = Infinity, onEviction } = {}) {
    super();
    this.maxSize = maxSize;
    this.onEviction = onEviction;
  }

  set(key, value) {
    if (this.has(key)) super.delete(key);
    super.set(key, value);
    while (this.size > this.maxSize) {
      const [oldKey, oldValue] = this.entries().next().value;
      super.delete(oldKey);
      if (this.onEviction) this.onEviction(oldKey, oldValue);
    }
    return this;
  }
}

module.exports = QuickLRU;
module.exports.default = QuickLRU;
