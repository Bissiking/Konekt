# Intégrer une application à Kyros SSO 4.4.0

> Ce document décrit le contrat Kyros `4.4.0`. Les métadonnées `kyros_sso_version`, `kyros_edition` et `kyros_application_scope` sont obligatoires sur tous les échanges d'authentification.

Ce guide décrit l’intégration d’une application ou d’un module à Kyros avec les modes `sso`, `direct` et `hybrid`, ainsi que le comportement des comptes rattachés à une entreprise.

Les exemples utilisent `https://kyros.example.fr` et `https://module.example.fr`. Remplace-les par les domaines de ton installation.

## Principe d’identité

Kyros conserve une identité utilisateur unique.

Un compte peut être :

- un compte Kyros sans rattachement entreprise ;
- un compte Kyros rattaché à une ou plusieurs entreprises ;
- un administrateur global Kyros.

Le rattachement entreprise ne crée pas une seconde identité ni un second mot de passe. Il enrichit le compte avec un contexte professionnel : entreprise, rôle, adresse professionnelle et permissions.

Exemple conceptuel :

```text
Compte Kyros
├── profil personnel
└── accès entreprise
    ├── entreprise
    ├── rôle
    ├── work_email
    └── permissions
```

Le `sub` du JWT et `user.id` restent les identifiants stables de la personne, quel que soit son rattachement entreprise.

## Hub Kyros et applications entreprise

Le hub Kyros peut afficher deux zones :

```text
ENTREPRISE
Applications autorisées par l’organisation

LUMA
Applications personnelles / générales
```

La présence du bloc Entreprise dépend du rattachement du compte. Une application entreprise du hub est affichée uniquement si elle est active, visible et autorisée pour l’utilisateur selon sa politique d’accès.

La visibilité dans le hub et l’autorisation SSO sont deux notions distinctes : une application peut être utilisable mais volontairement masquée du portail.

## Choisir le mode d’intégration

| Mode | À choisir quand | Particularité |
| --- | --- | --- |
| `sso` | Le navigateur doit passer par Kyros | L’application ne voit jamais le mot de passe |
| `direct` | Un backend interne possède déjà son propre formulaire de connexion | Le backend transmet les identifiants à Kyros |
| `hybrid` | L’application doit accepter les deux parcours | Autorise SSO et password grant |

Le mode `sso` est recommandé. Le mode `direct` doit rester réservé aux backends internes de confiance.

## Créer l’application

Dans l’administration Kyros, crée un client d’authentification avec au minimum :

- un nom ;
- un mode d’intégration ;
- une URL d’accueil ;
- une ou plusieurs URL de callback pour le SSO ;
- les scopes autorisés ;
- éventuellement une audience dédiée ;
- éventuellement des permissions entreprise requises.

Exemple :

```text
Nom              Planning
Mode             sso
URL accueil      https://module.example.fr
URL login        https://module.example.fr/login
Callback         https://module.example.fr/auth/callback
Scopes           profile email
Audience         kyros:sso:planning
```

Kyros normalise les doubles `/` accidentels dans le chemin. Par exemple :

```text
https://module.example.fr//auth/callback
```

est normalisé en :

```text
https://module.example.fr/auth/callback
```

Le `client_secret` n’est affiché qu’après la création ou une rotation. Ne l’envoie jamais au navigateur.

Le `client_secret` et le secret JWT global ont des rôles différents :

- `client_secret` authentifie l’application auprès de `/token` ;
- `JWT_SECRET` permet à un backend autorisé de vérifier localement les access tokens Kyros.

## Flow SSO

### 1. Générer `state`

Le backend de l’application génère une valeur aléatoire, la conserve dans sa session puis redirige le navigateur :

```text
https://kyros.example.fr/authorize?client_id=CLIENT_ID&redirect_uri=https%3A%2F%2Fmodule.example.fr%2Fauth%2Fcallback&scope=profile%20email&state=VALEUR_ALEATOIRE&kyros_sso_version=4.4.0&kyros_edition=standard&kyros_application_scope=standard
```

Construis l’URL avec une API dédiée comme `URL` et `URLSearchParams`. Évite la concaténation manuelle.

### 2. Autorisation par Kyros

Kyros vérifie notamment :

1. que le `client_id` existe et que l’application est active ;
2. que son mode autorise le SSO (`sso` ou `hybrid`) ;
3. que `redirect_uri` correspond à un callback déclaré ;
4. que l’utilisateur est connecté ;
5. que l’utilisateur possède l’accès requis à l’application.

Un administrateur global Kyros contourne les restrictions applicatives afin de conserver un accès de secours à l’administration.

Si une application possède des règles d’accès entreprise ou des permissions requises, Kyros vérifie les memberships de l’utilisateur avant d’émettre le code.

### 3. Recevoir le callback

Kyros redirige le navigateur vers :

```text
https://module.example.fr/auth/callback?code=CODE_TEMPORAIRE&state=VALEUR_ALEATOIRE
```

Le module doit impérativement vérifier que `state` correspond à la valeur conservée dans sa session.

### 4. Échanger le code côté serveur

```http
POST https://kyros.example.fr/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "client_id": "CLIENT_ID",
  "client_secret": "CLIENT_SECRET",
  "code": "CODE_TEMPORAIRE",
  "redirect_uri": "https://module.example.fr/auth/callback",
  "kyros_sso_version": "4.4.0",
  "kyros_edition": "standard",
  "kyros_application_scope": "standard"
}
```

Le code d’autorisation expire après cinq minutes et n’est utilisable qu’une seule fois.

Le `redirect_uri` fourni pendant l’échange doit correspondre au callback associé au code après normalisation.

## Login direct

Pour une application en mode `direct` ou `hybrid` :

```http
POST https://kyros.example.fr/token
Content-Type: application/json

{
  "grant_type": "password",
  "client_id": "CLIENT_ID",
  "client_secret": "CLIENT_SECRET",
  "username": "utilisateur@example.fr",
  "password": "mot-de-passe",
  "scope": "profile email"
}
```

`username` accepte un nom d’utilisateur ou un e-mail.

Le mot de passe ne doit jamais être conservé ni écrit dans les logs du module.

Même en login direct, Kyros applique les règles d’accès de l’application avant d’émettre les tokens.

## Accès entreprise à une application SSO

Une application d’authentification Kyros peut exiger des permissions entreprise.

Conceptuellement :

```text
Utilisateur
  ↓
Membership entreprise
  ↓
Permissions du membership
  ↓
Règle d’accès de l’application
  ↓
autorisé / refusé
```

Une application peut avoir :

- des permissions globales requises ;
- des règles spécifiques par entreprise ;
- aucune restriction, auquel cas tout utilisateur Kyros valide peut s’authentifier.

À l’heure actuelle, les règles SSO utilisent les permissions portées par le membership entreprise. Les groupes du portail Enterprise servent au filtrage des applications du hub mais ne sont pas encore injectés automatiquement dans l’évaluation SSO.

Cette distinction évite de documenter un droit implicite qui n’existe pas encore côté émission de token.

## Données entreprise dans les tokens

Quand l’utilisateur possède un accès entreprise autorisé pour l’application, Kyros ajoute son contexte professionnel à l’access token et à la réponse `/token`.

Exemple conceptuel :

```json
{
  "user": {
    "id": "usr_xxx",
    "username": "matheo",
    "enterpriseAccess": [
      {
        "companyId": "cmp_xxx",
        "companyName": "LUMA",
        "enterpriseRole": "company_admin",
        "permissions": [
          "planning:access",
          "planning:manage"
        ],
        "workEmail": "matheo@example.fr"
      }
    ]
  }
}
```

Le JWT expose également des claims entreprise dérivés des memberships autorisés, avec notamment :

```text
company_id
company_name
role
permissions
work_email
```

Une application ne doit pas supposer qu’il existe exactement une entreprise. Le modèle supporte plusieurs memberships, même si une installation donnée n’en utilise actuellement qu’une.

## Permissions : bonne pratique

Utilise des permissions spécifiques à l’application :

```text
planning:access
planning:manage

aion:access
aion:manage
aion:admin
```

Évite d’utiliser le rôle global Kyros `admin` comme droit métier dans une application.

Le rôle `admin` désigne un administrateur technique global Kyros et possède volontairement des privilèges de contournement.

## Renouveler les tokens

```http
POST https://kyros.example.fr/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "client_id": "CLIENT_ID",
  "client_secret": "CLIENT_SECRET",
  "refresh_token": "REFRESH_TOKEN"
}
```

Chaque utilisation fait tourner le refresh token.

Le module doit remplacer atomiquement l’ancien token par le nouveau.

Lors d’un refresh, Kyros recalcule l’accès applicatif. Si les droits de l’utilisateur ont été retirés depuis la connexion initiale, un nouveau token ne doit plus être émis.

Pour déconnecter l’utilisateur du module, envoie le refresh token à `POST /revoke` puis détruis la session locale de l’application.

## Profil disponible

Selon les données renseignées, `/token` et le JWT peuvent exposer :

- nom d’utilisateur ;
- prénom ;
- nom ;
- nom affiché ;
- e-mail ;
- téléphone ;
- avatar ;
- langue ;
- fuseau horaire ;
- bio ;
- date de naissance ;
- pronoms ;
- site ;
- ville ;
- pays ;
- rôle Kyros ;
- accès entreprise autorisés.

Tous les champs de profil doivent être considérés comme facultatifs.

Les identifiants stables sont :

- `sub` dans le JWT ;
- `user.id` dans la réponse `/token`.

Utilise-les comme clé de liaison avec le compte local de ton application. Ne lie jamais définitivement un compte à son adresse e-mail, car celle-ci peut changer.

## Vérifier un JWT

Le backend vérifie au minimum :

- la signature `HS256` avec le secret JWT Kyros ;
- `iss` ;
- `aud` ;
- `resource_aud` pour son propre module ;
- `exp` ;
- les scopes nécessaires.

Si l’application exploite les informations entreprise, elle doit également valider que le membership ou les permissions attendus sont présents dans les claims reçus.

Ne considère jamais la simple présence d’un bloc `enterpriseAccess` comme un droit administrateur.

## Variables d’environnement générées

Les noms de variables sont désormais **identiques pour toutes les applications**.

Kyros ne génère plus de préfixe dépendant du nom du module comme `NINO_KYROS_*` ou `JOBS_MANAGER_KYROS_*`. Chaque application reçoit le même contrat de configuration :

```env
AUTH_PROVIDER=kyros
KYROS_BASE_URL=https://kyros.example.fr
KYROS_SSO_VERSION=4.4.0
KYROS_EDITION=standard
KYROS_APPLICATION_SCOPE=standard
KYROS_AUTHORIZE_URL=https://kyros.example.fr/authorize
KYROS_TOKEN_URL=https://kyros.example.fr/token
KYROS_CLIENT_ID=cli_x
KYROS_CLIENT_SECRET=secret_client
KYROS_JWT_SECRET=secret_jwt_global
KYROS_ISSUER=kyros
KYROS_AUDIENCE=kyros-modules
KYROS_RESOURCE_AUDIENCE=kyros:sso:planning
KYROS_REQUESTED_SCOPE=profile email
KYROS_REQUIRED_SCOPES=profile email
KYROS_TIMEOUT_SECONDS=5
```

Ainsi, Nino, Aion, Planning ou n’importe quel autre module peuvent tous lire les mêmes clés :

```text
process.env.KYROS_BASE_URL
process.env.KYROS_CLIENT_ID
process.env.KYROS_CLIENT_SECRET
```

Seules les **valeurs** changent selon l’application.

Cette convention simplifie les exemples, les bibliothèques partagées et le copier-coller des configurations SSO.

## Exemple de décision d’accès

```text
Jean
└── Entreprise ACME
    ├── role: member
    └── permissions:
        └── planning:access

Planning
└── required_permissions:
    └── planning:access

Résultat : AUTORISÉ
```

Alors que :

```text
Jean
└── permissions:
    └── planning:access

Aion
└── required_permissions:
    └── aion:access

Résultat : REFUSÉ
```

## Erreurs utiles

### `invalid_redirect_uri`

Le callback envoyé ne correspond pas aux URLs déclarées. Compare le protocole, le domaine, le port et le chemin.

Kyros corrige les doubles `/` dans le chemin mais n’accepte pas silencieusement un autre domaine ou protocole.

### `invalid_code`

Le code :

- a expiré ;
- a déjà été utilisé ;
- appartient à une autre application ;
- ou le callback ne correspond pas.

### `invalid_client_secret`

Le secret applicatif est incorrect. Effectue une rotation dans l’administration Kyros puis remplace le secret côté backend.

### `app_access_denied`

Le compte est valide mais ne possède pas le membership ou les permissions nécessaires pour cette application.

Vérifie :

- le rattachement à l’entreprise ;
- le statut du membership ;
- les permissions du membership ;
- les règles d’accès configurées sur le client Kyros.

### `direct_login_not_allowed`

Le client est configuré en `sso`. Passe-le en `direct` ou `hybrid`, ou utilise le flow `/authorize`.

### `sso_not_allowed`

Le client n’autorise pas le flow navigateur. Passe-le en `sso` ou `hybrid`.

### `invalid_user_credentials`

Identifiant, e-mail ou mot de passe incorrect pendant un login direct.

## Résumé

Pour une nouvelle application, le parcours recommandé est :

```text
Créer le client Kyros
      ↓
Configurer callback + scopes + audience
      ↓
Configurer les permissions entreprise si nécessaire
      ↓
Rediriger vers /authorize
      ↓
Vérifier state
      ↓
Échanger le code côté serveur
      ↓
Vérifier le JWT
      ↓
Créer la session locale de l’application
```

Kyros reste la source d’identité. L’application consomme l’identité et les droits transmis, sans gérer elle-même le mot de passe en mode SSO.
