# 🚀 Konekt

Konekt est une application légère de gestion de disponibilités et de chat en temps réel pour les équipes. Authentification sécurisée via Kyros, base SQLite embarquée, et communication en WebSocket.

## 🧠 Fonctionnalités

- ✅ Authentification via Kyros OAuth 2.0
- ✅ Gestion des disponibilités (ajout, modification, suppression)
- ✅ Chat en temps réel
- ✅ Filtrage des disponibilités par date ou utilisateur
- ✅ Connexion multi-utilisateurs avec présence en ligne
- ✅ Historique des messages et des dispos
- ✅ Sécurité : Seul le créateur peut modifier ou supprimer ses dispos

---

## 🛠️ Stack technique

- Backend : Node.js + Express + Socket.IO + SQLite
- Frontend : HTML, CSS, JS Vanilla
- Authentification : Kyros OAuth 2.0
- Sockets sécurisés avec gestion des sessions

---

## 🚀 Lancement du projet

### 1. Clone le repo

```bash
git clone https://github.com/bissiking/konekt.git
cd konekt


KYROS_CLIENT_ID=***
KYROS_CLIENT_SECRET=***
KYROS_REDIRECT_URI=http://localhost:3001/auth/callback
KYROS_AUTH_URL=https://dev.api.mhemery.fr/auth/authorize
KYROS_TOKEN_ENDPOINT=https://dev.api.mhemery.fr/auth/token
KYROS_USERINFO_ENDPOINT=https://dev.api.mhemery.fr/userinfo
SESSION_SECRET=untrucbiensecret