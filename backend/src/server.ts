import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';
import { loadConfig } from './config';
import { KonektDatabase } from './database';
import {
  createAuthorizationUrl,
  createOauthState,
  exchangeAuthorizationCode,
  refreshAccessToken,
  resolveUser,
  revokeRefreshToken,
} from './kyros';
import type { KonektSession, KyrosTokenResponse, KyrosUser } from './types';
import { SQLiteSessionStore } from './session-store';

const config = loadConfig();
const projectRoot = path.resolve(__dirname, '../..');
const frontendRoot = path.join(projectRoot, 'frontend');
const uploadDir = path.join(projectRoot, 'uploads');
const databasePath = process.env.DATABASE_PATH || path.join(projectRoot, 'db.sqlite');
const database = new KonektDatabase(databasePath);
const kyrosImageOrigin = new URL(config.kyros.baseUrl).origin;

fs.mkdirSync(uploadDir, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_request, file, callback) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.jpg';
      callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype.startsWith('image/')) callback(null, true);
    else callback(new Error('Seules les images sont acceptées.'));
  },
});

const app = express();
const server = createServer(app);
const io = new SocketServer(server, { serveClient: true });

const sessionMiddleware = session({
  name: 'konekt.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new SQLiteSessionStore(databasePath),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use((_request, response, next) => {
  response.set({
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: https: ${kyrosImageOrigin}; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(sessionMiddleware);
app.use('/fonts', express.static(path.join(projectRoot, 'node_modules/@fontsource-variable/archivo/files'), { maxAge: '1y', immutable: true }));
app.use('/uploads', express.static(uploadDir, { maxAge: '1d' }));
app.use(express.static(frontendRoot, { extensions: ['html'] }));

function currentSession(request: Request): KonektSession {
  return request.session as KonektSession;
}

async function requireUser(request: Request, response: Response, next: NextFunction): Promise<void> {
  const activeSession = currentSession(request);
  let user = activeSession.user;
  if (!user) {
    response.status(401).json({ error: 'Ta session a expiré. Reconnecte-toi avec Kyros.' });
    return;
  }
  if (activeSession.tokenExpiresAt && activeSession.tokenExpiresAt <= Date.now() + 30_000) {
    if (!activeSession.refreshToken) {
      request.session.destroy(() => response.status(401).json({ error: 'Ta session Kyros doit être renouvelée.' }));
      return;
    }
    try {
      const tokens = await refreshAccessToken(config, activeSession.refreshToken);
      user = await resolveUser(config, tokens);
      saveTokens(activeSession, tokens, user);
      database.upsertUser(user);
    } catch {
      request.session.destroy(() => response.status(401).json({ error: 'Kyros a retiré ou expiré cet accès.' }));
      return;
    }
  }
  response.locals.user = user;
  next();
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 240) : '';
}

function cleanTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function cleanText(value: unknown, max = 1200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim().slice(0, 2000);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function daySlots(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const labels: string[] = [];
  const formatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const current = new Date(start);
  while (current <= end) {
    labels.push(formatter.format(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return labels;
}

function removeUploadedImage(imagePath: unknown): void {
  if (typeof imagePath !== 'string' || !imagePath.startsWith('/uploads/')) return;
  const file = path.join(uploadDir, path.basename(imagePath));
  fs.rm(file, { force: true }, (error) => {
    if (error) console.warn('[Events] Image introuvable à la suppression :', file);
  });
}

function saveTokens(target: KonektSession, tokens: KyrosTokenResponse, user: KyrosUser): void {
  target.user = user;
  target.accessToken = tokens.access_token;
  target.refreshToken = tokens.refresh_token || target.refreshToken;
  target.tokenExpiresAt = Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000;
}

app.get('/auth/start', (request, response) => {
  const target = typeof request.query.returnTo === 'string' && request.query.returnTo.startsWith('/') && !request.query.returnTo.startsWith('//')
    ? request.query.returnTo
    : '/';
  const state = createOauthState();
  const activeSession = currentSession(request);
  activeSession.oauthState = state;
  activeSession.returnTo = target;
  response.redirect(createAuthorizationUrl(config, state));
});

app.get('/auth/callback', async (request, response) => {
  const activeSession = currentSession(request);
  const state = typeof request.query.state === 'string' ? request.query.state : '';
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  if (!code || !state || !activeSession.oauthState || state !== activeSession.oauthState) {
    activeSession.oauthState = undefined;
    response.redirect('/?auth_error=invalid_callback');
    return;
  }

  const returnTo = activeSession.returnTo || '/';
  activeSession.oauthState = undefined;
  activeSession.returnTo = undefined;

  try {
    const tokens = await exchangeAuthorizationCode(config, code);
    const user = await resolveUser(config, tokens);
    database.upsertUser(user);
    await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
    saveTokens(currentSession(request), tokens, user);
    await new Promise<void>((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
    response.redirect(returnTo);
  } catch (error) {
    console.error('[Kyros] Callback refusé :', error instanceof Error ? error.message : error);
    response.redirect('/?auth_error=kyros_unavailable');
  }
});

app.get('/api/session', (request, response) => {
  const activeSession = currentSession(request);
  response.status(activeSession.user ? 200 : 401).json(activeSession.user
    ? { authenticated: true, user: activeSession.user }
    : { authenticated: false });
});

app.post('/api/session/refresh', async (request, response) => {
  const activeSession = currentSession(request);
  if (!activeSession.refreshToken) {
    response.status(401).json({ error: 'Aucune session Kyros renouvelable.' });
    return;
  }
  try {
    const tokens = await refreshAccessToken(config, activeSession.refreshToken);
    const user = await resolveUser(config, tokens);
    saveTokens(activeSession, tokens, user);
    database.upsertUser(user);
    response.json({ authenticated: true, user });
  } catch (error) {
    console.warn('[Kyros] Renouvellement refusé :', error instanceof Error ? error.message : error);
    request.session.destroy(() => response.status(401).json({ error: 'Kyros a refusé le renouvellement de la session.' }));
  }
});

app.delete('/api/session', (request, response) => {
  const refreshToken = currentSession(request).refreshToken;
  const finish = () => request.session.destroy(() => {
    response.clearCookie('konekt.sid');
    response.status(204).end();
  });
  if (!refreshToken) return finish();
  void revokeRefreshToken(config, refreshToken).catch((error) => {
    console.warn('[Kyros] Révocation distante impossible :', error instanceof Error ? error.message : error);
  }).finally(finish);
});

app.get('/api/availability', requireUser, (request, response) => {
  const from = typeof request.query.from === 'string' && validDate(request.query.from) ? request.query.from : undefined;
  const to = typeof request.query.to === 'string' && validDate(request.query.to) ? request.query.to : undefined;
  response.json(database.listAvailability((response.locals.user as KyrosUser).id, from, to));
});

app.post('/api/availability', requireUser, (request, response) => {
  if (!validDate(request.body.date)) {
    response.status(400).json({ error: 'Choisis une date valide.' });
    return;
  }
  const record = database.createAvailability(response.locals.user as KyrosUser, request.body.date, cleanNote(request.body.note));
  io.emit('availability:created', record);
  response.status(201).json(record);
});

app.patch('/api/availability/:id', requireUser, (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || !validDate(request.body.date)) {
    response.status(400).json({ error: 'La disponibilité est invalide.' });
    return;
  }
  const record = database.updateAvailability(id, (response.locals.user as KyrosUser).id, request.body.date, cleanNote(request.body.note));
  if (record === undefined) return void response.status(404).json({ error: 'Cette disponibilité n’existe plus.' });
  if (record === null) return void response.status(403).json({ error: 'Seul son auteur peut modifier cette disponibilité.' });
  io.emit('availability:updated', record);
  response.json(record);
});

app.delete('/api/availability/:id', requireUser, (request, response) => {
  const id = Number(request.params.id);
  const outcome = Number.isInteger(id)
    ? database.deleteAvailability(id, (response.locals.user as KyrosUser).id)
    : 'missing';
  if (outcome === 'missing') return void response.status(404).json({ error: 'Cette disponibilité n’existe plus.' });
  if (outcome === 'forbidden') return void response.status(403).json({ error: 'Seul son auteur peut supprimer cette disponibilité.' });
  io.emit('availability:deleted', { id });
  response.status(204).end();
});

app.post('/api/uploads', requireUser, (request, response) => {
  imageUpload.single('image')(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(400).json({ error: 'L’image dépasse 5 Mo.' });
      return;
    }
    if (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Image non acceptée.' });
      return;
    }
    const file = (request as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      response.status(400).json({ error: 'Choisis une image à téléverser.' });
      return;
    }
    response.status(201).json({ url: `/uploads/${file.filename}` });
  });
});

app.get('/api/events', requireUser, (request, response) => {
  response.json(database.listEvents((response.locals.user as KyrosUser).id));
});

app.post('/api/events', requireUser, (request, response) => {
  const startDate = typeof request.body.startDate === 'string' && validDate(request.body.startDate) ? request.body.startDate : '';
  const endDate = typeof request.body.endDate === 'string' && validDate(request.body.endDate) ? request.body.endDate : '';
  const title = cleanTitle(request.body.title);
  if (!title) {
    response.status(400).json({ error: 'Donne un titre à l’événement.' });
    return;
  }
  if (!startDate || !endDate || startDate > endDate) {
    response.status(400).json({ error: 'Choisis des dates de début et de fin valides.' });
    return;
  }
  const rawSlots = Array.isArray(request.body.slots) ? request.body.slots as unknown[] : [];
  const slots = rawSlots
    .filter((slot): slot is string => typeof slot === 'string' && slot.trim().length > 0)
    .map((slot) => slot.trim().slice(0, 80))
    .slice(0, 30);
  const imageUrl = cleanImageUrl(request.body.imageUrl);
  const imagePath = typeof request.body.imagePath === 'string' && request.body.imagePath.startsWith('/uploads/')
    ? request.body.imagePath.slice(0, 500)
    : null;
  const record = database.createEvent(response.locals.user as KyrosUser, {
    title,
    description: cleanText(request.body.description),
    location: cleanText(request.body.location, 120),
    imageUrl,
    imagePath,
    startDate,
    endDate,
    slots: slots.length ? slots : daySlots(startDate, endDate),
  });
  io.emit('event:created', record);
  response.status(201).json(record);
});

app.get('/api/events/:id', requireUser, (request, response) => {
  const id = Number(request.params.id);
  const record = Number.isInteger(id) ? database.getEvent(id, (response.locals.user as KyrosUser).id) : undefined;
  if (!record) {
    response.status(404).json({ error: 'Cet événement n’existe plus.' });
    return;
  }
  response.json(record);
});

app.patch('/api/events/:id', requireUser, (request, response) => {
  const id = Number(request.params.id);
  const startDate = typeof request.body.startDate === 'string' && validDate(request.body.startDate) ? request.body.startDate : '';
  const endDate = typeof request.body.endDate === 'string' && validDate(request.body.endDate) ? request.body.endDate : '';
  const title = cleanTitle(request.body.title);
  if (!Number.isInteger(id) || !title || !startDate || !endDate || startDate > endDate) {
    response.status(400).json({ error: 'L’événement est invalide.' });
    return;
  }
  const previous = database.getEvent(id, (response.locals.user as KyrosUser).id);
  if (!previous) {
    response.status(404).json({ error: 'Cet événement n’existe plus.' });
    return;
  }
  const imageUrl = cleanImageUrl(request.body.imageUrl);
  const imagePath = typeof request.body.imagePath === 'string' && request.body.imagePath.startsWith('/uploads/')
    ? request.body.imagePath.slice(0, 500)
    : null;
  if (imagePath && previous.imagePath && imagePath !== previous.imagePath) removeUploadedImage(previous.imagePath);
  const record = database.updateEvent(id, (response.locals.user as KyrosUser).id, {
    title,
    description: cleanText(request.body.description),
    location: cleanText(request.body.location, 120),
    imageUrl,
    imagePath,
    startDate,
    endDate,
  });
  if (record === undefined) {
    response.status(404).json({ error: 'Cet événement n’existe plus.' });
    return;
  }
  if (record === null) {
    response.status(403).json({ error: 'Seul son auteur peut modifier cet événement.' });
    return;
  }
  io.emit('event:updated', record);
  response.json(record);
});

app.delete('/api/events/:id', requireUser, (request, response) => {
  const id = Number(request.params.id);
  const current = database.getEvent(id, (response.locals.user as KyrosUser).id);
  const outcome = Number.isInteger(id) && current
    ? database.deleteEvent(id, (response.locals.user as KyrosUser).id)
    : 'missing';
  if (outcome === 'missing') return void response.status(404).json({ error: 'Cet événement n’existe plus.' });
  if (outcome === 'forbidden') return void response.status(403).json({ error: 'Seul son auteur peut supprimer cet événement.' });
  if (current) removeUploadedImage(current.imagePath);
  io.emit('event:deleted', { id });
  response.status(204).end();
});

app.post('/api/events/:id/slots', requireUser, (request, response) => {
  const id = Number(request.params.id);
  const label = typeof request.body.label === 'string' ? request.body.label.trim().slice(0, 80) : '';
  if (!Number.isInteger(id) || !label) {
    response.status(400).json({ error: 'Le créneau est invalide.' });
    return;
  }
  const record = database.addSlot(id, (response.locals.user as KyrosUser).id, label);
  if (record === undefined) {
    response.status(404).json({ error: 'Cet événement n’existe plus.' });
    return;
  }
  if (record === null) {
    response.status(403).json({ error: 'Seul son auteur peut ajouter un créneau.' });
    return;
  }
  io.emit('event:updated', record);
  response.status(201).json(record);
});

app.delete('/api/slots/:id', requireUser, (request, response) => {
  const id = Number(request.params.id);
  const slot = Number.isInteger(id) ? database.getSlot(id) : undefined;
  if (!slot) return void response.status(404).json({ error: 'Ce créneau n’existe plus.' });
  const outcome = database.deleteSlot(id, (response.locals.user as KyrosUser).id);
  if (outcome === 'forbidden') return void response.status(403).json({ error: 'Seul son auteur peut supprimer un créneau.' });
  const record = database.getEvent(slot.eventId, (response.locals.user as KyrosUser).id);
  if (record) io.emit('event:updated', record);
  response.status(204).end();
});

app.put('/api/events/:id/slots/:slotId/response', requireUser, (request, response) => {
  const slotId = Number(request.params.slotId);
  const eventId = Number(request.params.id);
  const status = request.body.status === 'yes' || request.body.status === 'no' ? request.body.status : null;
  const slot = Number.isInteger(slotId) && Number.isInteger(eventId) ? database.getSlot(slotId) : undefined;
  if (!slot || slot.eventId !== eventId) {
    response.status(404).json({ error: 'Ce créneau n’existe plus.' });
    return;
  }
  const record = database.setResponse(response.locals.user as KyrosUser, slotId, status);
  if (!record) {
    response.status(404).json({ error: 'Cet événement n’existe plus.' });
    return;
  }
  io.emit('event:updated', record);
  response.json(record);
});

app.get('/api/messages', requireUser, (_request, response) => response.json(database.listMessages()));

interface PresenceRecord { user: KyrosUser; sockets: Set<string> }
const presence = new Map<string, PresenceRecord>();

function publicPresence(): Array<{ id: string; username: string; displayName: string; avatarUrl?: string }> {
  return [...presence.values()].map(({ user }) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  }));
}

app.get('/api/presence', requireUser, (_request, response) => response.json(publicPresence()));

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const request = socket.request as typeof socket.request & { session?: KonektSession };
  if (!request.session?.user) return next(new Error('unauthorized'));
  next();
});

io.on('connection', (socket) => {
  const request = socket.request as typeof socket.request & { session: KonektSession };
  const user = request.session.user!;
  const existing = presence.get(user.id) || { user, sockets: new Set<string>() };
  existing.user = user;
  existing.sockets.add(socket.id);
  presence.set(user.id, existing);
  io.emit('presence:changed', publicPresence());

  socket.on('message:send', (raw: unknown, acknowledge?: (result: unknown) => void) => {
    const content = typeof raw === 'string' ? raw.trim().slice(0, 1000) : '';
    if (!content) return acknowledge?.({ ok: false, error: 'Écris un message avant de l’envoyer.' });
    const message = database.createMessage(user, content);
    io.emit('message:created', message);
    acknowledge?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const record = presence.get(user.id);
    record?.sockets.delete(socket.id);
    if (record && record.sockets.size === 0) presence.delete(user.id);
    io.emit('presence:changed', publicPresence());
  });
});

app.get('*splat', (_request, response) => response.sendFile(path.join(frontendRoot, 'index.html')));

server.listen(config.port, () => {
  console.log(`Konekt écoute sur http://localhost:${config.port}`);
});
