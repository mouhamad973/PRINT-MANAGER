# Design system

La référence vivante est la page `/design-system` de l'application. Les tokens sont définis dans `apps/web/src/app/globals.css`.

## Principes

L'interface sert des responsables techniques et financiers qui l'utilisent toute la journée, en bureau ou près des machines. Elle privilégie la densité, la lisibilité et l'alignement des chiffres. La marque tient à quelques détails précis, pas à la décoration.

- **Le repère d'impression et la gamme de contrôle CMJN** en haut de la sidebar sont le seul élément décoratif, et ils viennent du métier.
- **Les encres CMJN sont réservées aux données et à la marque.** Elles ne servent jamais au texte ni aux actions : le jaune serait illisible, et une couleur d'encre doit toujours signifier un canal.
- **Un seul accent :** le bleu reflex, encre de référence des imprimeurs, pour les actions principales.
- **Les couleurs d'état signifient toujours un état,** et sont toujours accompagnées d'un texte.

## Couleurs

| Rôle       | Tokens                                                                                |
| ---------- | ------------------------------------------------------------------------------------- |
| Neutres    | `background`, `surface`, `muted`, `border`, `input`, `foreground`, `muted-foreground` |
| Accent     | `primary`, `primary-hover`, `primary-foreground`, `ring`                              |
| États      | `success`, `warning`, `danger`                                                        |
| Navigation | `sidebar`, `sidebar-foreground`, `sidebar-muted`, `sidebar-accent`, `sidebar-border`  |
| Encres     | `ink-cyan`, `ink-magenta`, `ink-yellow`, `ink-black`                                  |

La sidebar reste sombre dans les deux thèmes. En thème sombre, `ink-black` devient gris clair pour rester visible.

## Typographie

Archivo, auto-hébergée via Fontsource : aucune requête externe, ce qui compte pour l'On-Premise. Le texte courant fait 14 px, et les tableaux utilisent des chiffres tabulaires.

| Usage              | Style            |
| ------------------ | ---------------- |
| Titre de page      | 20 px, semi-gras |
| Titre de section   | 16 px, semi-gras |
| Texte courant      | 14 px            |
| Libellé secondaire | 12 px            |

## Formes

Les rayons sont petits (3, 5 et 7 px) et les bords fins. Il n'y a pas d'ombre sur les surfaces de contenu.

## Composants

Les composants suivent l'approche shadcn/ui : le code est dans le dépôt (`apps/web/src/components/ui`), configuré par `components.json`. La commande `shadcn add` peut en ajouter d'autres.

Disponibles : `Button`, `Input`, `Label`, `Badge`, `Table`, `Skeleton`, `Panel`.

## Modules non livrés

Un module à venir reste visible dans la sidebar, désactivé et marqué de sa phase (`P3`). La recherche et les notifications du header restent désactivées jusqu'à la livraison de leurs modules. Une fonction non implémentée ne doit jamais paraître disponible.
