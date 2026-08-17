# Konekt

Konekt est le point de disponibilité partagé d'une équipe : créneaux, présence et fil de discussion en temps réel, avec une identité entièrement déléguée à Kyros V4.

## Fonctionnalités

- SSO Kyros V4 avec contrôle de `state`, rotation du refresh token et révocation à la déconnexion
- contexte entreprise Kyros compatible avec plusieurs memberships
- disponibilités créées, modifiées et supprimées uniquement par leur auteur
- événements d'équipe avec dates, notes, lieu, image (URL ou téléversée) et réponses de disponibilité par créneau
- présence multi-onglets et fil d'équipe via Socket.IO
- historique conservé dans SQLite
- interface responsive, accessible au clavier et sans framework client

## Prérequis

- Node.js 22.5 ou plus récent, pour `node:sqlite`
- une application Kyros en mode `sso` ou `hybrid`
- un callback Kyros déclaré, par défaut `http://localhost:3001/auth/callback`

La permission Kyros recommandée pour limiter l'application aux membres autorisés est `konekt:access`.

## Installation

```bash
npm install
cp .env.example .env
```

Renseigner ensuite au minimum `SESSION_SECRET`, `KYROS_CLIENT_ID` et `KYROS_CLIENT_SECRET` dans `.env`.

En déploiement, `PUBLIC_BASE_URL` doit être l'origine publique exacte enregistrée dans Kyros. Konekt en déduit automatiquement le callback `<PUBLIC_BASE_URL>/auth/callback`.

```bash
npm run dev
```

Konekt est alors disponible sur [http://localhost:3001](http://localhost:3001).

## Vérification et production

```bash
npm run check
npm run build
npm start
```

En production, utiliser HTTPS et définir `NODE_ENV=production`. Le cookie de session devient alors automatiquement `Secure`, `HttpOnly` et `SameSite=Lax`.

## Variables Kyros 4.4.0

Les métadonnées `KYROS_SSO_VERSION`, `KYROS_EDITION` et `KYROS_APPLICATION_SCOPE` sont obligatoires. Konekt les envoie sous leurs noms de protocole en minuscules sur l'autorisation, l'échange du code, le renouvellement et la révocation.

| Variable | Rôle | Valeur par défaut |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | URL publique canonique de Konekt | `http://localhost:<PORT>` |
| `AUTH_PROVIDER` | Fournisseur d'identité, obligatoirement `kyros` | aucune |
| `KYROS_SSO_VERSION` | Version du handshake, obligatoirement `4.4.0` | aucune |
| `KYROS_EDITION` | Édition `standard` ou `enterprise` | aucune |
| `KYROS_APPLICATION_SCOPE` | Périmètre `standard`, `enterprise` ou `both` | aucune |
| `KYROS_BASE_URL` | Base de l'instance Kyros | `https://dev.api.mhemery.fr` |
| `KYROS_AUTHORIZE_URL` | Endpoint d'autorisation | `<base>/authorize` |
| `KYROS_TOKEN_URL` | Échange et renouvellement des tokens | `<base>/token` |
| `KYROS_USERINFO_URL` | Profil de secours si `/token` ne contient pas `user` | `<base>/userinfo` |
| `KYROS_REVOKE_URL` | Révocation du refresh token | `<base>/revoke` |
| `KYROS_REDIRECT_URI` | Surcharge facultative du callback dérivé de `PUBLIC_BASE_URL` | aucune |
| `KYROS_REQUESTED_SCOPE` | Scopes demandés | `profile email` |
| `KYROS_REQUIRED_SCOPES` | Scopes obligatoires dans le JWT | aucune |
| `KYROS_JWT_SECRET` | Vérification HS256 locale du token | aucune |
| `KYROS_ISSUER` | Émetteur JWT attendu | aucune |
| `KYROS_AUDIENCE` | Audience JWT attendue | aucune |
| `KYROS_RESOURCE_AUDIENCE` | Audience propre à Konekt | aucune |

Le `client_secret` et les tokens ne sont jamais envoyés au navigateur. Les détails du contrat V4 sont conservés dans [sso-guide.md](sso-guide.md).

## Architecture

```text
backend/src/
  config.ts       validation de la configuration
  database.ts     migration et accès SQLite
  kyros.ts        client SSO Kyros V4
  server.ts       API, session et temps réel
  types.ts        contrats internes
frontend/
  index.html      structure et états de l'application
  css/style.css   système visuel responsive
  js/app.js       client, rendu sûr et Socket.IO
```

Les tables historiques `users`, `dispos` et `messages` sont migrées en place au démarrage. Aucune remise à zéro de la base n'est nécessaire.
