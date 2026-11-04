# Design system

La référence vivante est la page `/design-system` de l'application. Les tokens sont définis dans `apps/web/src/app/globals.css`.

## Direction

La direction visuelle s'inspire de trois maquettes de tableaux de bord choisies par le client :

- un tableau de bord vert : panneaux blancs flottants, carte vedette pleine couleur, boutons pilule, barre d'élément actif dans le menu ;
- un tableau de bord e-commerce bleu : indicateurs avec contexte, tableaux aérés, en-tête avec recherche ;
- un tableau de bord sombre : bloc organisation en haut du menu, libellés de section en capitales espacées, panneaux sombres en couches.

L'interface sert des responsables techniques et financiers qui l'utilisent toute la journée, en bureau ou près des machines. Elle reste lisible et dense là où il le faut, notamment dans les tableaux et les chiffres alignés.

## Principes

- **Un seul accent : le vert sapin,** pour les actions, l'élément actif du menu et la carte vedette.
- **Une seule carte vedette par page,** en dégradé vert, pour l'indicateur principal. Toutes les autres surfaces sont blanches, ou ardoise en thème sombre.
- **Les encres CMJN sont réservées aux données et à la marque.** Elles ne servent jamais au texte ni aux actions : le jaune serait illisible, et une couleur d'encre doit toujours signifier un canal. Hors données, elles n'apparaissent que dans la gamme de contrôle, en bas du menu et sur la page de connexion.
- **Les couleurs d'état signifient toujours un état.** Elles sont accompagnées d'une pastille et d'un texte, jamais seules.
- **Aucune donnée inventée.** Une valeur inconnue s'affiche « — », jamais zéro. Les exemples de la page Design system sont signalés comme tels.

## Mise en page

- **Canevas :** fond gris-vert. La sidebar, l'en-tête et les contenus sont des panneaux flottants, espacés de 12 px.
- **Sidebar :** marque, bloc organisation (l'entreprise de la session, ou la plateforme pour un Super Administrateur), groupes de navigation, déconnexion, gamme de contrôle CMJN. L'élément actif est en gras, avec une icône verte et une barre verte au bord du panneau.
- **En-tête :** recherche en pilule, thème, notifications, puis le compte avec son nom et son adresse.
- **Pages :** titre de 32 px, description, actions à droite. Viennent ensuite les indicateurs (`StatCard`), puis les panneaux (`Panel` et `PanelHeader`).
- **Mobile :** la sidebar s'ouvre en tiroir, et les indicateurs passent sur deux colonnes, la carte vedette sur toute la largeur.

## Couleurs

| Rôle          | Tokens                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Neutres       | `background`, `surface`, `surface-raised`, `muted`, `border`, `input`, `foreground`, `muted-foreground` |
| Accent        | `primary`, `primary-hover`, `primary-foreground`, `primary-soft`, `primary-soft-foreground`, `ring`     |
| Carte vedette | `hero-from`, `hero-to`, `hero-foreground`, `hero-muted`, classe `.hero-surface`                         |
| États         | `success`, `warning`, `danger`                                                                          |
| Navigation    | `sidebar`, `sidebar-foreground`, `sidebar-muted`, `sidebar-accent`, `sidebar-border`                    |
| Graphiques    | `chart-1` à `chart-5`                                                                                   |
| Encres        | `ink-cyan`, `ink-magenta`, `ink-yellow`, `ink-black`                                                    |

Les alias shadcn/ui (`card`, `popover`, `secondary`, `accent`, `destructive`, `sidebar-primary`…) pointent vers ces tokens. Un composant ajouté par `shadcn add` prend donc directement les couleurs d'ARKSEN.

En thème sombre, le canevas est une ardoise froide, les panneaux sont un cran plus clairs, et le vert est éclairci pour rester lisible. `ink-black` devient gris clair.

## Typographie

Geist, auto-hébergée via Fontsource : aucune requête externe, ce qui compte pour l'On-Premise. Ses chiffres tabulaires alignent les mesures dans les tableaux et les indicateurs.

| Usage               | Style                                 |
| ------------------- | ------------------------------------- |
| Titre de page       | 32 px, semi-gras, approche resserrée  |
| Valeur d'indicateur | 40 px, semi-gras, chiffres tabulaires |
| Titre de panneau    | 16 px, semi-gras                      |
| Texte courant       | 14 px                                 |
| En-tête de tableau  | 11 px, capitales espacées             |
| Libellé secondaire  | 12 à 13 px                            |

## Formes

| Élément                     | Rayon                   |
| --------------------------- | ----------------------- |
| Panneaux, cartes, dialogues | 20 px (`rounded-2xl`)   |
| Champs et éléments de menu  | 12 px (`rounded-md`)    |
| Boutons, badges, recherche  | pilule (`rounded-full`) |

Les panneaux ont un bord très fin et une ombre douce et décalée. La carte vedette porte une ombre teintée de vert.

## Composants

Les composants suivent l'approche shadcn/ui : le code est dans le dépôt (`apps/web/src/components/ui`), configuré par `components.json`. La commande `shadcn add` peut en ajouter d'autres.

| Composant                                   | Rôle                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Button`, `IconButton`                      | Pilule pleine (`primary`), contour vert (`secondary`), `ghost`, `danger` ; bouton rond d'en-tête |
| `StatCard`                                  | Indicateur : libellé, grande valeur, unité, contexte, lien fléché optionnel                      |
| `Panel`, `PanelHeader`                      | Panneau flottant et son titre, avec ses actions                                                  |
| `Badge`, `StatusDot`                        | État en pilule teintée, avec pastille                                                            |
| `Table`                                     | En-têtes en capitales, lignes de 56 px, survol discret                                           |
| `Input`, `Select`, `Field`, `SearchInput`   | Champs de 40 px, anneau de focus vert                                                            |
| `Dialog`, `Pagination`, `Skeleton`, `Label` | Dialogue, pagination, chargement, libellé                                                        |

## Modules non livrés

Un module à venir reste visible dans la sidebar, en gris et marqué de sa phase (`P3`). La recherche et les notifications de l'en-tête restent désactivées jusqu'à la livraison de leurs modules. Une fonction non implémentée ne doit jamais paraître disponible : un lien fléché de `StatCard` n'apparaît que s'il mène à une vraie page.
