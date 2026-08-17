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

export interface EventSlotRecord {
  id: number;
  label: string;
  sortOrder: number;
  responses: Array<{
    user: { id: string; username: string; displayName: string; avatarUrl: string | null };
    status: 'yes' | 'no';
  }>;
  myStatus: 'yes' | 'no' | null;
}

export interface EventRecord {
  id: number;
  title: string;
  description: string;
  location: string;
  imageUrl: string | null;
  imagePath: string | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  author: { id: string; username: string; displayName: string; avatarUrl: string | null };
  ownedByCurrentUser: boolean;
  slots: EventSlotRecord[];
  yesCount: number;
  participantCount: number;
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
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        image_path TEXT,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS event_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('yes', 'no')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (slot_id, user_id),
        FOREIGN KEY (slot_id) REFERENCES event_slots(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    ensureColumn(this.db, 'users', 'avatar_url', 'TEXT');
    ensureColumn(this.db, 'users', 'profile_json', "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn(this.db, 'dispos', 'created_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    ensureColumn(this.db, 'dispos', 'updated_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dispos_date ON dispos(date);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_event_slots_event ON event_slots(event_id);
      CREATE INDEX IF NOT EXISTS idx_event_responses_slot ON event_responses(slot_id);
      CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_date);
    `);
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

  listEvents(currentUserId: string): EventRecord[] {
    const rows = this.db.prepare(`
      SELECT e.id, e.title, e.description, e.location, e.image_url AS imageUrl, e.image_path AS imagePath,
             e.start_date AS startDate, e.end_date AS endDate, e.created_at AS createdAt,
             u.kyros_id AS authorId, u.username AS authorUsername, u.name AS authorName, u.avatar_url AS authorAvatar
      FROM events e JOIN users u ON u.id = e.user_id
      ORDER BY e.start_date ASC, e.created_at ASC
    `).all() as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.hydrateEvent(row, currentUserId));
  }

  getEvent(id: number, currentUserId: string): EventRecord | undefined {
    const row = this.db.prepare(`
      SELECT e.id, e.title, e.description, e.location, e.image_url AS imageUrl, e.image_path AS imagePath,
             e.start_date AS startDate, e.end_date AS endDate, e.created_at AS createdAt,
             u.kyros_id AS authorId, u.username AS authorUsername, u.name AS authorName, u.avatar_url AS authorAvatar
      FROM events e JOIN users u ON u.id = e.user_id
      WHERE e.id = ?
    `).get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrateEvent(row, currentUserId) : undefined;
  }

  private hydrateEvent(row: Record<string, unknown>, currentUserId: string): EventRecord {
    const slots = this.db.prepare(`
      SELECT id, label, sort_order AS sortOrder FROM event_slots WHERE event_id = ? ORDER BY sort_order ASC, id ASC
    `).all(Number(row.id)) as unknown as Array<{ id: number; label: string; sortOrder: number }>;
    const slotRecords: EventSlotRecord[] = slots.map((slot) => {
      const responses = this.db.prepare(`
        SELECT u.kyros_id AS id, u.username, u.name AS displayName, u.avatar_url AS avatarUrl, r.status
        FROM event_responses r JOIN users u ON u.id = r.user_id
        WHERE r.slot_id = ?
        ORDER BY u.name COLLATE NOCASE ASC, u.username ASC
      `).all(slot.id) as unknown as Array<{ id: string; username: string; displayName: string; avatarUrl: string | null; status: 'yes' | 'no' }>;
      return {
        id: slot.id,
        label: slot.label,
        sortOrder: slot.sortOrder,
        responses: responses.map(({ id, username, displayName, avatarUrl, status }) => ({
          user: { id, username, displayName, avatarUrl },
          status,
        })),
        myStatus: responses.find((response) => response.id === currentUserId)?.status ?? null,
      };
    });
    const allYes = slotRecords.flatMap((slot) => slot.responses.filter((response) => response.status === 'yes').map((response) => response.user.id));
    return {
      id: Number(row.id),
      title: row.title as string,
      description: row.description as string,
      location: row.location as string,
      imageUrl: row.imageUrl as string | null,
      imagePath: row.imagePath as string | null,
      startDate: row.startDate as string,
      endDate: row.endDate as string,
      createdAt: row.createdAt as string,
      author: {
        id: row.authorId as string,
        username: row.authorUsername as string,
        displayName: row.authorName as string,
        avatarUrl: row.authorAvatar as string | null,
      },
      ownedByCurrentUser: row.authorId === currentUserId,
      slots: slotRecords,
      yesCount: allYes.length,
      participantCount: new Set(allYes).size,
    };
  }

  createEvent(user: KyrosUser, data: {
    title: string;
    description: string;
    location: string;
    imageUrl: string | null;
    imagePath: string | null;
    startDate: string;
    endDate: string;
    slots: string[];
  }): EventRecord {
    const userId = this.upsertUser(user);
    const result = this.db.prepare(`
      INSERT INTO events (title, description, location, image_url, image_path, start_date, end_date, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.title, data.description, data.location, data.imageUrl, data.imagePath, data.startDate, data.endDate, userId);
    const eventId = Number(result.lastInsertRowid);
    const labels = data.slots.length ? data.slots : [data.startDate];
    labels.forEach((label, index) => {
      this.db.prepare('INSERT INTO event_slots (event_id, label, sort_order) VALUES (?, ?, ?)').run(eventId, label, index);
    });
    return this.getEvent(eventId, user.id)!;
  }

  updateEvent(id: number, ownerId: string, data: {
    title: string;
    description: string;
    location: string;
    imageUrl: string | null;
    imagePath: string | null;
    startDate: string;
    endDate: string;
  }): EventRecord | null | undefined {
    const record = this.getEvent(id, ownerId);
    if (!record) return undefined;
    if (!record.ownedByCurrentUser) return null;
    this.db.prepare(`
      UPDATE events SET title = ?, description = ?, location = ?, image_url = ?, image_path = ?, start_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(data.title, data.description, data.location, data.imageUrl, data.imagePath, data.startDate, data.endDate, id);
    return this.getEvent(id, ownerId);
  }

  deleteEvent(id: number, ownerId: string): 'deleted' | 'forbidden' | 'missing' {
    const record = this.getEvent(id, ownerId);
    if (!record) return 'missing';
    if (!record.ownedByCurrentUser) return 'forbidden';
    this.db.prepare('DELETE FROM events WHERE id = ?').run(id);
    return 'deleted';
  }

  getSlot(slotId: number): { eventId: number; ownerId: string } | undefined {
    const row = this.db.prepare(`
      SELECT s.id, s.event_id AS eventId, u.kyros_id AS ownerId
      FROM event_slots s JOIN events e ON e.id = s.event_id JOIN users u ON u.id = e.user_id
      WHERE s.id = ?
    `).get(slotId) as { eventId: number; ownerId: string } | undefined;
    return row;
  }

  addSlot(eventId: number, ownerId: string, label: string): EventRecord | null | undefined {
    const event = this.getEvent(eventId, ownerId);
    if (!event) return undefined;
    if (!event.ownedByCurrentUser) return null;
    const order = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS next FROM event_slots WHERE event_id = ?').get(eventId) as { next: number };
    this.db.prepare('INSERT INTO event_slots (event_id, label, sort_order) VALUES (?, ?, ?)').run(eventId, label, order.next + 1);
    return this.getEvent(eventId, ownerId);
  }

  deleteSlot(slotId: number, ownerId: string): 'deleted' | 'forbidden' | 'missing' {
    const slot = this.getSlot(slotId);
    if (!slot) return 'missing';
    if (slot.ownerId !== ownerId) return 'forbidden';
    this.db.prepare('DELETE FROM event_slots WHERE id = ?').run(slotId);
    return 'deleted';
  }

  setResponse(user: KyrosUser, slotId: number, status: 'yes' | 'no' | null): EventRecord | null | undefined {
    const slot = this.getSlot(slotId);
    if (!slot) return undefined;
    const userId = this.upsertUser(user);
    if (status) {
      this.db.prepare(`
        INSERT INTO event_responses (slot_id, user_id, status) VALUES (?, ?, ?)
        ON CONFLICT(slot_id, user_id) DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP
      `).run(slotId, userId, status);
    } else {
      this.db.prepare('DELETE FROM event_responses WHERE slot_id = ? AND user_id = ?').run(slotId, userId);
    }
    return this.getEvent(slot.eventId, user.id);
  }
}
