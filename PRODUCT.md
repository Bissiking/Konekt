# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Konekt s'adresse en priorité aux petites équipes internes déjà rattachées à une organisation dans Kyros. Elles l'utilisent au fil de la journée pour dire rapidement quand elles sont disponibles, voir qui peut participer et échanger sans changer d'outil.

Les comptes Kyros personnels restent techniquement compatibles tant que la politique d'accès configurée dans Kyros les autorise. Konekt ne recrée pas de rôles ou de mots de passe locaux.

## Product Purpose

Konekt réunit disponibilités, présence en ligne et conversation d'équipe dans un espace partagé très léger. Son succès se mesure à la vitesse avec laquelle un groupe peut répondre à la question « qui est disponible, quand, et pour quoi ? ».

## Positioning

Contrairement à un calendrier complet ou à une messagerie généraliste, Konekt organise la conversation autour de signaux de disponibilité explicites et immédiatement visibles.

## Operating Context

L'application est ouverte ponctuellement ou gardée dans un onglet pendant la journée. Les utilisateurs consultent d'abord les prochaines disponibilités, ajoutent ou ajustent la leur, puis utilisent le fil d'équipe pour préciser le contexte.

## Capabilities and Constraints

- Authentification exclusivement déléguée à Kyros V4 en mode SSO OAuth 2.0.
- Identité stable fondée sur le claim `sub` ou `user.id` de Kyros.
- Support du contexte multi-entreprises exposé par `enterpriseAccess`, sans supposer une entreprise unique.
- Disponibilités datées avec note optionnelle, modifiables et supprimables uniquement par leur auteur.
- Présence multi-onglets et chat en temps réel via Socket.IO.
- Historique local persistant dans SQLite.
- Stack conservée et modernisée : Node.js, TypeScript, Express, Socket.IO, HTML/CSS/JavaScript sans framework client.
- L'accès applicatif et les permissions métier restent configurables dans Kyros. La permission recommandée est `konekt:access`.

## Brand Commitments

Le nom Konekt et le logo existant dans `frontend/assets/Konekt.png` sont conservés. La voix est directe, conviviale et concise, en français.

## Evidence on Hand

- Ancienne interface et comportements dans `frontend/`.
- Ancien serveur fonctionnel dans `backend/app.js`.
- Guide local d'intégration Kyros V4 dans `sso-guide.md`.
- Logo historique dans `frontend/assets/Konekt.png`.
- Aucun témoignage, métrique ou contenu commercial ne doit être inventé.

## Product Principles

1. Montrer l'état de l'équipe avant de demander une action.
2. Rendre l'ajout d'une disponibilité plus rapide qu'un message explicatif.
3. Garder la conversation proche du planning sans lui voler la priorité.
4. Faire confiance à Kyros pour l'identité et les droits ; ne pas dupliquer sa logique.
5. Rester utile et lisible sur un petit écran comme sur un poste de travail.

## Accessibility & Inclusion

L'interface vise WCAG 2.2 AA : navigation clavier, focus visible, contrastes suffisants, libellés explicites, annonces pour les mises à jour importantes et prise en compte de `prefers-reduced-motion`.
