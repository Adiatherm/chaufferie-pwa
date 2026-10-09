# ADIATOOL — v5 · Nettoyage du moteur de formulaires

Aucun changement fonctionnel volontaire. Objectif : supprimer la duplication
de code qui rendait `forms-engine.js` inopérant et provoquait des régressions
inexpliquées.

## Problème corrigé

`index.html` charge les scripts dans cet ordre :

    forms-data.js → forms-engine.js → app.js

`app.js` contenait une **copie périmée** du moteur de formulaires
(27 fonctions). Chargé en dernier, il écrasait systématiquement
`forms-engine.js`, dont les 1 026 lignes n'étaient donc jamais exécutées.

Conséquences :
- les opérations personnalisées du cahier de maintenance (`customOps`),
  écrites mais inaccessibles ;
- le rattachement des équipements aux instances de modules répétables
  (`moduleContext`) inopérant : un équipement saisi sur « Circuit chauffage 2 »
  s'affichait sur tous les circuits ;
- une correction appliquée à `forms-engine.js` restait sans effet, ce qui
  explique les régressions constatées d'une session à l'autre.

## Modifications

### app.js — 2166 → 1293 lignes
- suppression du moteur de formulaires dupliqué (lignes 480 à 1339) ;
- suppression d'une seconde déclaration de `refreshAllEquipInline()`
  (la fonction était déclarée deux fois dans le même fichier) ;
- `getMFD()` et `saveMFD()` sont conservés : ils ne sont pas dans
  `forms-engine.js` ;
- bandeau d'avertissement ajouté à l'emplacement du bloc supprimé.

### forms-engine.js — 1026 → 990 lignes
- `refreshAllEquipInline()` réécrivait intégralement le HTML des cartes
  équipement, en divergence avec `buildEquipmentInline()` :

  | | à la création | au rafraîchissement |
  |---|---|---|
  | état « bon » | ✅ Bon état | ✅ Bon |
  | état « hs » | ❌ Hors service | ❌ HS |
  | observations | affichées | absentes |

  La carte changeait donc d'apparence après ajout d'un équipement.
  La fonction délègue désormais au `_refresh` posé par `buildEquipmentInline()`,
  qui devient la source unique du markup.

### style.css
- ajout de `.equip-cards-list` (conteneur utilisé par `forms-engine.js`,
  absent de la feuille de style).

### sw.js
- cache `adiatool-v5` → `adiatool-v6` pour forcer le rechargement des assets.

## Règle à respecter

Ne jamais redéclarer dans `app.js` une fonction définie dans
`forms-engine.js` : `app.js` étant chargé en dernier, la redéclaration
l'emporte silencieusement.

## Vérifications passées

| Test | Résultat |
|---|---|
| Syntaxe des 5 fichiers JS | OK |
| Fonctions déclarées en double | 0 (contre 27) |
| Démarrage, splash, navigation | OK |
| Création site → mission → local | OK |
| Rendu des 8 modules | 8/8, 65 champs |
| Blocs équipement + `_refresh` | OK |
| Ajout d'équipement et rafraîchissement | OK |
| Isolation des données entre locaux | OK |
| Sauvegarde de champ sans reconstruction du DOM | OK |
| Repli / dépli des blocs | OK |
| Exports CSV / Word / PDF | OK |
| Erreurs console | 0 |

## À vérifier sur iPhone après déploiement

1. Vider le cache ou désinstaller/réinstaller la PWA (changement de version
   du service worker).
2. Ouvrir une mission, ajouter un local, activer les modules.
3. Ajouter un équipement : vérifier que la carte affiche marque, modèle,
   année, état et observations, et qu'elle reste identique après ajout d'un
   second équipement.
4. Cahier de maintenance : vérifier la présence du bouton d'ajout
   d'opération personnalisée (nouveauté rendue accessible).
5. Circuits chauffage répétables : saisir un équipement sur le circuit 2 et
   vérifier qu'il n'apparaît pas sur le circuit 1.

---

# v5.1 — Modules repliés à l'activation

## Problème

Lors de la sélection des modules d'un local, chaque module activé s'ouvrait
immédiatement déplié. Après deux ou trois sélections, la liste des modules
disparaissait de l'écran et l'opérateur perdait de vue ce qu'il avait déjà coché.

## Correction

`forms-engine.js` — un module fraîchement activé est désormais inséré à l'état
replié. Le sélecteur reste visible pendant toute la phase de sélection.
L'opérateur déplie ensuite les blocs un par un, au moment de les remplir.

Le comportement s'applique aussi aux instances des modules répétables
(circuits chauffage, circuits ECS, compteurs).

Aucun changement pour le reste : l'état de repli reste mémorisé par local
(`collapseState`) et survit aux re-rendus. Un bloc désactivé puis réactivé
revient replié.

`sw.js` — cache `adiatool-v6` → `adiatool-v7`.

## Vérifications passées

| Test | Résultat |
|---|---|
| 8 modules activés successivement | 8 blocs, 0 déplié |
| Sélecteur de modules toujours visible | OK |
| Ouverture manuelle d'un bloc | OK |
| État conservé après re-rendu | OK |
| Désactivation puis réactivation | revient replié |
| Non-régression (rendu, équipements, exports) | 0 erreur |

---

# v5.2 — Énergie par local, conditionnement, pré-sélection, cycle de vie

## 1.2 — L'énergie descend au niveau du local

Jusqu'ici l'énergie était lue sur le site. Une chaufferie gaz alimentant des
sous-stations sur réseau primaire, ou un site CPCU avec appoint gaz, ne
pouvaient donc pas être décrits correctement.

- `forms-data.js` : nouvelle liste `LOCAL_ENERGIES` (8 valeurs, dont
  « Réseau primaire interne »).
- Chaque local porte un champ `energie`. Vide = hérite du site.
- Le sélecteur affiche « ↳ GAZ (site) » comme première option : dans la
  majorité des cas l'opérateur n'a rien à changer.
- `forms-engine.js` : `currentEnergie` provient désormais de
  `getLocalEnergie()` et non plus du site.

## 1.3 — Conditionnement au niveau des sections

Le moteur ne savait masquer que des champs isolés. Une section entière peut
maintenant être conditionnée par le type de local ou l'énergie
(`sectionVisible()`).

Première application : la section **ÉNERGIE / GAZ** du module Conformité
(7 champs) est conditionnée à `['GAZ','Fioul']`. Sur un local CPCU ou réseau
de chaleur, l'opérateur ne voit plus compteur gaz, vanne de barrage,
électrovanne, anti-micro-coupures, détection gaz, filtre gaz ni plaque de
fumisterie.

## 1.4 — Pré-sélection automatique des modules

L'opérateur devait cocher manuellement les 8 modules de chaque local.
Désormais le type de local détermine la sélection proposée :

| Type de local | Modules proposés |
|---|---|
| Chaufferie | les 8 |
| Sous-station (principale ou non) | 7 (sans cahier de maintenance) |
| Local TGBT / surpresseur / autre | 2 (Généralités, Autres matériels) |

Les blocs sont insérés repliés (v5.1), donc la liste des modules reste
visible. Changer le type de local repropose la sélection adaptée — sauf si
l'opérateur a déjà touché la sélection à la main (`modulesTouches`), auquel
cas son choix est préservé.

Un garde-fou vérifie que les identifiants proposés existent réellement dans
`FORM_MODULES` et journalise l'écart le cas échéant.

## 1.6 — Cycle de vie des équipements

Un équipement n'a plus à être supprimé : il change de statut.

| Statut | Signification |
|---|---|
| En service | présent et en fonctionnement |
| Déposé | retiré sans remplacement |
| Remplacé | retiré et remplacé |

Le statut s'ajoute à l'état visuel (qui reste une donnée de patrimoine) et
s'affiche sur la carte. L'historique est ainsi préservé pour les plans
pluriannuels de travaux.

`sw.js` — cache `adiatool-v7` → `adiatool-v8`.

## Bug corrigé au passage

La première version de la table de pré-sélection utilisait l'identifiant
`autres` alors que le module s'appelle `autres_materiels` : le module
« Autres matériels » n'était jamais activé. Détecté au test, corrigé, et un
garde-fou empêche désormais ce type d'erreur de passer silencieusement.

## Vérifications passées

| Test | Résultat |
|---|---|
| Pré-sélection chaufferie | 8 modules, 8 blocs, tous repliés |
| Pré-sélection local surpresseur | 2 modules |
| Sélection manuelle préservée après changement de type | OK |
| Héritage de l'énergie du site | OK |
| Surcharge au niveau du local | OK, site inchangé |
| Section GAZ masquée en CPCU | 0/7 champs rendus |
| Section GAZ visible en GAZ | 7/7 champs rendus |
| Deux locaux, deux énergies | conditionnement indépendant |
| Cycle de vie : affichage et persistance | OK |
| Non-régression (rendu, équipements, exports, repli) | 0 erreur |

## À vérifier sur le terrain

1. Créer un local : les modules doivent être pré-cochés et repliés.
2. Passer le local en CPCU : la section ÉNERGIE / GAZ doit disparaître de
   Conformité.
3. Créer un second local avec une autre énergie et vérifier que chacun garde
   son propre conditionnement.
4. Éditer un équipement : le champ « Cycle de vie » doit apparaître sous
   l'état visuel.
