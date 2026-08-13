# Konekt — Carnet de relève

## Direction

Konekt emprunte au carnet de permanence : une surface de travail fraîche et lumineuse, une colonne temporelle très lisible, des repères colorés qui signifient réellement un état et une conversation attenante au planning. L'interface refuse le tableau de bord SaaS fait de cartes équivalentes.

## Palette

- Papier froid `#F2F3F0` : surface générale adaptée à un usage de bureau prolongé.
- Encre `#17212B` : texte et structure.
- Bleu registre `#2457D6` : action principale et sélection.
- Orange relève `#F0642B` : attention et moments proches.
- Vert présence `#16845B` : disponibilité et connexion effective.
- Traits `#CBD0CC` : règles, séparations et champs.

## Typographie

Archivo Variable est auto-hébergée. Les titres utilisent une chasse légèrement condensée et un poids fort ; les données horaires utilisent des chiffres tabulaires. Le corps reste sobre, généreux et lisible.

## Composition

- En-tête compact, stable et utilitaire.
- Rail d'équipe étroit à gauche sur grand écran.
- Planning dominant au centre, structuré par jours et heures plutôt que par cartes.
- Fil d'équipe à droite, rétractable sur les écrans plus étroits.
- Sur mobile, le planning reste premier ; présence et conversation deviennent des panneaux dédiés.

## Composants et états

Les panneaux ont un rayon discret de 14 px. Les traits remplacent les ombres quand ils suffisent. Les pastilles sont réservées aux états, filtres et compteurs. Les actions destructives sont explicites et confirmées. Chargement, vide, erreur, hors-ligne et session expirée possèdent chacun un rendu et un texte dédiés.

## Mouvement

Un seul moment signé : à l'ouverture de session, la ligne du jour se déploie comme une feuille qu'on pose sur le registre. Les panneaux mobiles glissent selon leur provenance. Tout mouvement est neutralisé avec `prefers-reduced-motion`.

## Responsive

Au-dessous de 1080 px, la présence rejoint l'en-tête. Au-dessous de 760 px, l'application devient monocolonne avec une barre d'actions basse. Aucun miniature illisible du planning desktop n'est conservé.
