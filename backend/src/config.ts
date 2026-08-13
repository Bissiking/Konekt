import * as process from 'node:process';
import 'dotenv/config';

export interface KyrosConfig {
  provider: string;
  ssoVersion: string;
  edition: 'standard' | 'enterprise';
  applicationScope: 'standard' | 'enterprise' | 'both';
  baseUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  revokeUrl: string;
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
  issuer: string;
  audience: string;
  resourceAudience: string;
  requestedScope: string;
  requiredScopes: string[];
  timeoutMs: number;
}

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  redirectUri: string;
  sessionSecret: string;
  kyros: KyrosConfig;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value.trim();
}

function oneOf<T extends string>(name: string, allowed: readonly T[]): T {
  const value = required(name).toLowerCase();
  if (!allowed.includes(value as T)) {
    throw new Error(`${name} doit valoir ${allowed.join(' ou ')}.`);
  }
  return value as T;
}

export function normalizePublicBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_BASE_URL doit être une URL absolue valide.');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('PUBLIC_BASE_URL doit utiliser HTTPS, sauf sur localhost.');
  }
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString().replace(/\/$/, '');
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT est invalide.');
  const publicBaseUrl = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`);
  const baseUrl = process.env.KYROS_BASE_URL || 'https://dev.api.mhemery.fr';
  const provider = required('AUTH_PROVIDER').toLowerCase();
  if (provider !== 'kyros') throw new Error('AUTH_PROVIDER doit valoir kyros.');
  const ssoVersion = required('KYROS_SSO_VERSION');
  if (ssoVersion !== '4.4.0') throw new Error('KYROS_SSO_VERSION doit valoir 4.4.0.');
  const edition = oneOf('KYROS_EDITION', ['standard', 'enterprise'] as const);
  const applicationScope = oneOf('KYROS_APPLICATION_SCOPE', ['standard', 'enterprise', 'both'] as const);
  const expectedEdition = applicationScope === 'standard' ? 'standard' : 'enterprise';
  if (edition !== expectedEdition) {
    throw new Error(`KYROS_EDITION doit valoir ${expectedEdition} pour le périmètre ${applicationScope}.`);
  }

  const kyros: KyrosConfig = {
    provider,
    ssoVersion,
    edition,
    applicationScope,
    baseUrl,
    authorizeUrl:
      process.env.KYROS_AUTHORIZE_URL || `${baseUrl}/authorize`,
    tokenUrl: process.env.KYROS_TOKEN_URL || `${baseUrl}/token`,
    userinfoUrl: process.env.KYROS_USERINFO_URL || `${baseUrl}/userinfo`,
    revokeUrl: process.env.KYROS_REVOKE_URL || `${baseUrl}/revoke`,
    clientId: required('KYROS_CLIENT_ID'),
    clientSecret: required('KYROS_CLIENT_SECRET'),
    jwtSecret: required('KYROS_JWT_SECRET'),
    issuer: required('KYROS_ISSUER'),
    audience: required('KYROS_AUDIENCE'),
    resourceAudience: required('KYROS_RESOURCE_AUDIENCE'),
    requestedScope: process.env.KYROS_REQUESTED_SCOPE || 'profile email',
    requiredScopes: required('KYROS_REQUIRED_SCOPES').split(/\s+/).filter(Boolean),
    timeoutMs: Number(process.env.KYROS_TIMEOUT_SECONDS || 8) * 1000,
  };

  return {
    port,
    publicBaseUrl,
    redirectUri:
      process.env.KYROS_REDIRECT_URI ||
      `${publicBaseUrl}/auth/callback`,
    sessionSecret: required('SESSION_SECRET'),
    kyros,
  };
}
