import { DatabaseSync } from 'node:sqlite';
import session from 'express-session';

interface SessionRow { data: string; expires_at: number }

export class SQLiteSessionStore extends session.Store {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    super();
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS app_sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry ON app_sessions(expires_at);
    `);
    this.prune();
  }

  private prune(): void {
    this.database.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').run(Date.now());
  }

  get(sid: string, callback: (error: unknown, session?: session.SessionData | null) => void): void {
    try {
      const row = this.database.prepare('SELECT data, expires_at FROM app_sessions WHERE sid = ?').get(sid) as unknown as SessionRow | undefined;
      if (!row || row.expires_at <= Date.now()) {
        if (row) this.database.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sid);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.data) as session.SessionData);
    } catch (error) {
      callback(error);
    }
  }

  set(sid: string, value: session.SessionData, callback?: (error?: unknown) => void): void {
    try {
      const expiresAt = value.cookie.expires?.getTime() || Date.now() + (value.cookie.maxAge || 86_400_000);
      this.database.prepare(`
        INSERT INTO app_sessions (sid, data, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
      `).run(sid, JSON.stringify(value), expiresAt);
      if (Math.random() < 0.01) this.prune();
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    try {
      this.database.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid: string, value: session.SessionData, callback?: (error?: unknown) => void): void {
    try {
      const expiresAt = value.cookie.expires?.getTime() || Date.now() + (value.cookie.maxAge || 86_400_000);
      this.database.prepare('UPDATE app_sessions SET expires_at = ? WHERE sid = ?').run(expiresAt, sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
}
