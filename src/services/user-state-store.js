const fs = require('fs');
const path = require('path');

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class UserStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.dir = path.dirname(filePath);
    this.map = new Map();
    this.flushTimer = null;
    this.ensureLoaded();
  }

  ensureLoaded() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ users: {} }, null, 2), 'utf8');
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const users = parsed && typeof parsed === 'object' ? parsed.users : null;
      if (users && typeof users === 'object') {
        Object.entries(users).forEach(([userId, payload]) => {
          this.map.set(userId, payload);
        });
      }
    } catch {
      this.map.clear();
    }
  }

  get(userId) {
    const key = String(userId || '').trim();
    if (!key) return null;
    const entry = this.map.get(key);
    if (!entry) return null;
    return cloneJson(entry);
  }

  set(userId, statePayload) {
    const key = String(userId || '').trim();
    if (!key) return;
    const payload = {
      updatedAt: new Date().toISOString(),
      state: cloneJson(statePayload || {}),
    };
    this.map.set(key, payload);
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, 220);
  }

  flushNow() {
    const users = {};
    this.map.forEach((value, key) => {
      users[key] = value;
    });

    const body = JSON.stringify({ users }, null, 2);
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, body, 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}

module.exports = {
  UserStateStore,
};
