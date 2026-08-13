import { createServer } from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
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
const databasePath = process.env.DATABASE_PATH || path.join(projectRoot, 'db.sqlite');
const database = new KonektDatabase(databasePath);
const kyrosImageOrigin = new URL(config.kyros.baseUrl).origin;

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
