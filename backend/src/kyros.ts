import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from './config';
import type { EnterpriseAccess, KyrosTokenResponse, KyrosUser } from './types';

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function protocolHandshake(config: AppConfig): Record<string, string> {
  return {
    kyros_sso_version: config.kyros.ssoVersion,
    kyros_edition: config.kyros.edition,
    kyros_application_scope: config.kyros.applicationScope,
  };
}

function includesClaim(value: unknown, expected: string): boolean {
  return typeof value === 'string' ? value === expected : Array.isArray(value) && value.includes(expected);
}

function scopesFromClaims(claims: Record<string, unknown>): string[] {
  if (typeof claims.scope === 'string') return claims.scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(claims.scopes)) return claims.scopes.filter((scope): scope is string => typeof scope === 'string');
  return [];
}

export function verifyAccessToken(config: AppConfig, token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Le token Kyros n’est pas un JWT valide.');

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('L’en-tête du token Kyros est invalide.');
  }
  if (header.alg !== 'HS256') throw new Error('Kyros a utilisé un algorithme JWT inattendu.');

  const expected = createHmac('sha256', config.kyros.jwtSecret).update(`${parts[0]}.${parts[1]}`).digest();
  let received: Buffer;
  try {
    received = Buffer.from(parts[2], 'base64url');
  } catch {
    throw new Error('La signature du token Kyros est invalide.');
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error('La signature du token Kyros est invalide.');
  }

  const claims = decodeJwtPayload(token);
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('Le token Kyros a expiré.');
  if (claims.iss !== config.kyros.issuer) throw new Error('L’émetteur du token Kyros est invalide.');
  if (!includesClaim(claims.aud, config.kyros.audience)) throw new Error('L’audience du token Kyros est invalide.');
  if (!includesClaim(claims.resource_aud, config.kyros.resourceAudience)) {
    throw new Error('Le token Kyros n’est pas destiné à Konekt.');
  }
  const grantedScopes = new Set(scopesFromClaims(claims));
  const missingScopes = config.kyros.requiredScopes.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length) throw new Error(`Le token Kyros ne contient pas les scopes requis : ${missingScopes.join(', ')}.`);
  return claims;
}

function normalizeEnterpriseAccess(value: unknown): EnterpriseAccess[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    return [{
      companyId: asText(item.companyId ?? item.company_id),
      companyName: asText(item.companyName ?? item.company_name),
      enterpriseRole: asText(item.enterpriseRole ?? item.role),
      permissions: Array.isArray(item.permissions)
        ? item.permissions.filter((permission): permission is string => typeof permission === 'string')
        : [],
      workEmail: asText(item.workEmail ?? item.work_email),
    }];
  });
}

function normalizeAvatarUrl(value: unknown, kyrosBaseUrl?: string): string | undefined {
  const avatar = asText(value);
  if (!avatar) return undefined;
  try {
    const url = kyrosBaseUrl ? new URL(avatar, kyrosBaseUrl) : new URL(avatar);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeUser(raw: Record<string, unknown>, kyrosBaseUrl?: string): KyrosUser {
  const id = asText(raw.id ?? raw.sub);
  if (!id) throw new Error('Kyros n’a pas fourni d’identifiant utilisateur stable.');

  const username = asText(raw.username) || asText(raw.email) || id;
  const displayName = asText(raw.displayName ?? raw.display_name ?? raw.name)
    || [asText(raw.first_name ?? raw.firstName), asText(raw.last_name ?? raw.lastName)].filter(Boolean).join(' ')
    || username;

  return {
    id,
    username,
    displayName,
    email: asText(raw.email),
    avatarUrl: normalizeAvatarUrl(raw.avatarUrl ?? raw.avatar_url ?? raw.avatar ?? raw.picture, kyrosBaseUrl),
    enterpriseAccess: normalizeEnterpriseAccess(raw.enterpriseAccess ?? raw.enterprise_access ?? raw.enterprise),
  };
}

async function kyrosRequest<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
  });

  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const detail = asText(body.error_description ?? body.error) || `HTTP ${response.status}`;
    throw new Error(`Kyros a refusé la requête : ${detail}`);
  }
  return body as T;
}

export function createAuthorizationUrl(config: AppConfig, state: string): string {
  const url = new URL(config.kyros.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.kyros.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.kyros.requestedScope,
    state,
    ...protocolHandshake(config),
  }).toString();
  return url.toString();
}

export function createOauthState(): string {
  return randomBytes(32).toString('base64url');
}

export async function exchangeAuthorizationCode(config: AppConfig, code: string): Promise<KyrosTokenResponse> {
  return kyrosRequest<KyrosTokenResponse>(config.kyros.tokenUrl, {
    method: 'POST',
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.kyros.clientId,
      client_secret: config.kyros.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      ...protocolHandshake(config),
    }),
  }, config.kyros.timeoutMs);
}

export async function refreshAccessToken(config: AppConfig, refreshToken: string): Promise<KyrosTokenResponse> {
  return kyrosRequest<KyrosTokenResponse>(config.kyros.tokenUrl, {
    method: 'POST',
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: config.kyros.clientId,
      client_secret: config.kyros.clientSecret,
      refresh_token: refreshToken,
      ...protocolHandshake(config),
    }),
  }, config.kyros.timeoutMs);
}

export async function resolveUser(config: AppConfig, tokens: KyrosTokenResponse): Promise<KyrosUser> {
  const claims = verifyAccessToken(config, tokens.access_token);
  if (tokens.user && typeof tokens.user === 'object') {
    return normalizeUser({ ...claims, ...tokens.user }, config.kyros.baseUrl);
  }

  try {
    const profile = await kyrosRequest<Record<string, unknown>>(config.kyros.userinfoUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }, config.kyros.timeoutMs);
    return normalizeUser({ ...claims, ...profile }, config.kyros.baseUrl);
  } catch (error) {
    if (claims.sub || claims.id) return normalizeUser(claims, config.kyros.baseUrl);
    throw error;
  }
}

export async function revokeRefreshToken(config: AppConfig, refreshToken: string): Promise<void> {
  await kyrosRequest(config.kyros.revokeUrl, {
    method: 'POST',
    body: JSON.stringify({
      client_id: config.kyros.clientId,
      client_secret: config.kyros.clientSecret,
      refresh_token: refreshToken,
      ...protocolHandshake(config),
    }),
  }, config.kyros.timeoutMs);
}
