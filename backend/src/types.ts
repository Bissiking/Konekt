import type { Session, SessionData } from 'express-session';

export interface EnterpriseAccess {
  companyId?: string;
  companyName?: string;
  enterpriseRole?: string;
  permissions: string[];
  workEmail?: string;
}

export interface KyrosUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  enterpriseAccess: EnterpriseAccess[];
}

export interface KyrosTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  user?: Record<string, unknown>;
}

export interface KonektSessionData extends SessionData {
  oauthState?: string;
  returnTo?: string;
  user?: KyrosUser;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

export type KonektSession = Session & KonektSessionData;
