import { DatabaseSync } from 'node:sqlite';
import type { KyrosUser } from './types';

export interface AvailabilityRecord {
  id: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  date: string;
  note: string;
  createdAt: string;
  ownedByCurrentUser?: boolean;
}

export interface MessageRecord {
  id: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  content: string;
  timestamp: string;
}

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function ensureColumn(db: DatabaseSync, table: string, name: string, definition: string): void {
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export class KonektDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kyros_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dispos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    ensureColumn(this.db, 'users', 'avatar_url', 'TEXT');
    ensureColumn(this.db, 'users', 'profile_json', "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn(this.db, 'dispos', 'created_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    ensureColumn(this.db, 'dispos', 'updated_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_dispos_date ON dispos(date); CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);');
  }

  upsertUser(user: KyrosUser): number {
    this.db.prepare(`
      INSERT INTO users (kyros_id, username, name, avatar_url, profile_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(kyros_id) DO UPDATE SET
        username = excluded.username,
        name = excluded.name,
        avatar_url = excluded.avatar_url,
        profile_json = excluded.profile_json
    `).run(user.id, user.username, user.displayName, user.avatarUrl || null, JSON.stringify(user));
    const record = this.db.prepare('SELECT id FROM users WHERE kyros_id = ?').get(user.id) as { id: number };
    return record.id;
  }

  listAvailability(currentUserId: string, from?: string, to?: string): AvailabilityRecord[] {
    const where: string[] = [];
    const params: string[] = [];
    if (from) { where.push('d.date >= ?'); params.push(from); }
    if (to) { where.push('d.date <= ?'); params.push(to); }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT d.id, u.kyros_id AS userId, u.username, u.name AS displayName,
             u.avatar_url AS avatarUrl, d.date, d.note, d.created_at AS createdAt
      FROM dispos d JOIN users u ON u.id = d.user_id
      ${filter}
      ORDER BY d.date ASC, d.created_at ASC
    `).all(...params) as unknown as AvailabilityRecord[];
    return rows.map((row) => ({ ...row, ownedByCurrentUser: row.userId === currentUserId }));
  }

  createAvailability(user: KyrosUser, date: string, note: string): AvailabilityRecord {
    const userId = this.upsertUser(user);
    const result = this.db.prepare('INSERT INTO dispos (user_id, date, note) VALUES (?, ?, ?)').run(userId, date, note);
    return this.getAvailability(Number(result.lastInsertRowid), user.id)!;
  }

  getAvailability(id: number, currentUserId: string): AvailabilityRecord | undefined {
    const row = this.db.prepare(`
      SELECT d.id, u.kyros_id AS userId, u.username, u.name AS displayName,
             u.avatar_url AS avatarUrl, d.date, d.note, d.created_at AS createdAt
      FROM dispos d JOIN users u ON u.id = d.user_id WHERE d.id = ?
    `).get(id) as unknown as AvailabilityRecord | undefined;
    return row ? { ...row, ownedByCurrentUser: row.userId === currentUserId } : undefined;
  }

  updateAvailability(id: number, ownerId: string, date: string, note: string): AvailabilityRecord | null | undefined {
    const record = this.getAvailability(id, ownerId);
    if (!record) return undefined;
    if (record.userId !== ownerId) return null;
    this.db.prepare('UPDATE dispos SET date = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(date, note, id);
    return this.getAvailability(id, ownerId);
  }

  deleteAvailability(id: number, ownerId: string): 'deleted' | 'forbidden' | 'missing' {
    const record = this.getAvailability(id, ownerId);
    if (!record) return 'missing';
    if (record.userId !== ownerId) return 'forbidden';
    this.db.prepare('DELETE FROM dispos WHERE id = ?').run(id);
    return 'deleted';
  }

  listMessages(limit = 100): MessageRecord[] {
    return this.db.prepare(`
      SELECT m.id, u.kyros_id AS userId, u.username, u.name AS displayName,
             u.avatar_url AS avatarUrl, m.content, m.timestamp
      FROM messages m JOIN users u ON u.id = m.user_id
      ORDER BY m.timestamp DESC LIMIT ?
    `).all(limit).reverse() as unknown as MessageRecord[];
  }

  createMessage(user: KyrosUser, content: string): MessageRecord {
    const userId = this.upsertUser(user);
    const result = this.db.prepare('INSERT INTO messages (user_id, content) VALUES (?, ?)').run(userId, content);
    return this.db.prepare(`
      SELECT m.id, u.kyros_id AS userId, u.username, u.name AS displayName,
             u.avatar_url AS avatarUrl, m.content, m.timestamp
      FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
    `).get(Number(result.lastInsertRowid)) as unknown as MessageRecord;
  }
}
