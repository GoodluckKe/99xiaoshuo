const fs = require('fs');
const path = require('path');

function createFileSessionStore(session) {
  class FileSessionStore extends session.Store {
    constructor(options = {}) {
      super();
      this.filePath = options.filePath || path.join(process.cwd(), 'data', 'sessions.json');
      this.ttlMs = Math.max(60 * 1000, Number(options.ttlMs || 7 * 24 * 60 * 60 * 1000));
      this.flushTimer = null;
      this.sessions = new Map();
      this.ensureLoaded();
    }

    ensureLoaded() {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify({ sessions: {} }, null, 2), 'utf8');
        return;
      }
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        const sessions = parsed && typeof parsed === 'object' ? parsed.sessions : null;
        if (sessions && typeof sessions === 'object') {
          Object.entries(sessions).forEach(([sid, payload]) => {
            this.sessions.set(sid, payload);
          });
        }
      } catch {
        this.sessions.clear();
      }
      this.pruneExpired();
    }

    get(sid, callback) {
      try {
        const payload = this.sessions.get(String(sid));
        if (!payload) {
          callback(null, null);
          return;
        }
        if (this.isExpired(payload)) {
          this.sessions.delete(String(sid));
          this.scheduleFlush();
          callback(null, null);
          return;
        }
        callback(null, payload.session || null);
      } catch (error) {
        callback(error);
      }
    }

    set(sid, sessionData, callback) {
      try {
        const expiresAt = this.getExpiresAt(sessionData);
        this.sessions.set(String(sid), {
          expiresAt,
          updatedAt: new Date().toISOString(),
          session: sessionData,
        });
        this.scheduleFlush();
        callback && callback(null);
      } catch (error) {
        callback && callback(error);
      }
    }

    destroy(sid, callback) {
      try {
        this.sessions.delete(String(sid));
        this.scheduleFlush();
        callback && callback(null);
      } catch (error) {
        callback && callback(error);
      }
    }

    touch(sid, sessionData, callback) {
      this.set(sid, sessionData, callback);
    }

    all(callback) {
      try {
        this.pruneExpired();
        const list = [];
        this.sessions.forEach((payload) => {
          if (payload && payload.session) list.push(payload.session);
        });
        callback(null, list);
      } catch (error) {
        callback(error);
      }
    }

    clear(callback) {
      this.sessions.clear();
      this.scheduleFlush();
      callback && callback(null);
    }

    getExpiresAt(sessionData) {
      const cookieExpires = sessionData?.cookie?.expires;
      if (cookieExpires) {
        const parsed = new Date(cookieExpires).getTime();
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
      return Date.now() + this.ttlMs;
    }

    isExpired(payload) {
      const expiresAt = Number(payload?.expiresAt || 0);
      if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
      return Date.now() >= expiresAt;
    }

    pruneExpired() {
      let changed = false;
      this.sessions.forEach((payload, sid) => {
        if (this.isExpired(payload)) {
          this.sessions.delete(sid);
          changed = true;
        }
      });
      if (changed) this.scheduleFlush();
    }

    scheduleFlush() {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushNow();
      }, 220);
    }

    flushNow() {
      const sessions = {};
      this.sessions.forEach((payload, sid) => {
        sessions[sid] = payload;
      });
      const body = JSON.stringify({ sessions }, null, 2);
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, body, 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    }
  }

  return FileSessionStore;
}

module.exports = {
  createFileSessionStore,
};
