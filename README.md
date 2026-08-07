# Scrabble — Le Défi

**Entraînement au Scrabble francophone, hors ligne, sur PC Windows.**
Aucune dépendance, aucun compte, aucun `npm install`.

L'application pose une grille de partie déjà entamée et un tirage de sept lettres.
Le but : trouver **le coup qui rapporte le plus de points**. Ni plus, ni moins —
tant que le maximum n'est pas atteint, le problème n'est pas résolu.

Écrit pour mon grand-père, qui a fait un peu de compétition.

- Dictionnaire **ODS9** complet (416 349 formes), consultable en pleine partie,
  avec les définitions du Wiktionnaire
- Problèmes générés à l'infini sur quatre niveaux, calibrés automatiquement
- Solveur exhaustif (Appel & Jacobson sur DAWG) : l'objectif affiché est
  réellement le maximum atteignable
- Sauvegarde permanente, chronomètre et records par niveau
- Mise à jour du dictionnaire en un clic, avec retour arrière

---

## Installer

```
git clone https://github.com/Zerdanes/scrabble-problems.git
cd scrabble-problems
```

Puis double-cliquez sur **`Scrabble.bat`**.

Au **premier lancement uniquement**, l'application télécharge la liste officielle
des mots et construit son dictionnaire (une minute, connexion requise — voir
« Les mots ne sont pas dans ce dépôt » plus bas). Ensuite, tout fonctionne hors
ligne.

Une fenêtre de jeu s'ouvre ; une petite fenêtre noire reste réduite dans la barre
des tâches, c'est normal (c'est le moteur). Tout se ferme quand vous quittez.

Relancer `Scrabble.bat` alors que le jeu tourne déjà **ne démarre pas un second
moteur** : la fenêtre existante est ramenée au premier plan. Sans ce garde-fou,
deux instances écriraient tour à tour dans la même sauvegarde.

- `Scrabble (sans fenetre).vbs` fait la même chose sans aucune fenêtre noire.
  Si Windows bloque les fichiers `.vbs`, restez sur le `.bat`.
- `creer-raccourci-bureau.ps1` (clic droit → Exécuter avec PowerShell) pose un
  raccourci sur le Bureau, avec l'icône du jeu. À lancer une seule fois.

L'icône est un jeton de Scrabble dessiné par le programme
(`build\make-icon.js`) : le tracé du **S** est obtenu par distance à deux arcs
de cercle, ce qui donne un trait net de 16 à 256 px, et le chiffre est omis en
dessous de 48 px où il ne serait qu'une bavure. PNG et ICO sont encodés à la
main, sans bibliothèque.

**Prérequis : [Node.js](https://nodejs.org) 18 ou plus.** Rien d'autre.

### Les mots ne sont pas dans ce dépôt

L'Officiel du Scrabble est une œuvre éditée par Larousse. Les dépôts qui en
diffusent la liste sont sous licence MIT, mais **une licence MIT sur un dépôt ne
confère aucun droit sur le contenu lui-même**. Ce dépôt ne redistribue donc ni la
liste de mots, ni les dictionnaires compilés qui en dérivent : ils sont
téléchargés au premier lancement, sur votre machine.

Conséquence : le dépôt fait ~140 Ko et ne contient que du code.

---

## Jouer

### Poser un mot

1. Cliquez sur la case où le mot commence. Un curseur vert apparaît.
2. Recliquez sur la même case pour basculer entre horizontal (▸) et vertical (▾).
3. Tapez les lettres au clavier, ou cliquez sur les jetons du chevalet.
4. Le mot formé et son score s'affichent **en direct**, à droite.
5. `Entrée` ou **Valider le coup**.

| Touche | Effet |
|---|---|
| A–Z | pose la lettre (prend un joker si la lettre manque) |
| `Retour arrière` | retire le dernier jeton posé |
| `Entrée` | valide le coup |
| `Échap` | retire tous les jetons posés |
| flèches | déplace le curseur |
| `Ctrl+D` | ouvre le dictionnaire |

Cliquer sur un jeton déjà posé le reprend. Le joker (`?`) ouvre une grille A–Z ;
au clavier, taper une lettre absente du tirage l'utilise automatiquement.

### Les quatre niveaux

| Niveau | Ce qui vous attend |
|---|---|
| **Facile** | Mot courant d'au moins 3 lettres, 2 à 4 jetons, ~17 à 38 points. |
| **Moyen** | Toujours un mot courant, mais la bonne case est moins évidente. ~30 à 56 points. |
| **Difficile** | Grille chargée, 6 jetons en moyenne, le mot peut être rare. 50 à 115 points. |
| **Extrême** | Un Scrabble (les 7 lettres) est presque toujours la solution. Jusqu'à 158 points. |

Aux niveaux Facile et Moyen, la solution est **garantie** être un mot du langage
courant. Ce réglage ne concerne que le choix des problèmes proposés : **tous les
mots de l'ODS restent jouables à tout moment, à tous les niveaux**. Aucun mot n'a
été retiré du jeu parce qu'il était difficile.

### Aides

- **💡 Indice** — quatre indices de plus en plus précis (nombre de jetons, sens et
  longueur, case de départ, première lettre). En utiliser un fait toujours compter
  le problème comme résolu, mais le temps ne compte plus pour le record.
- **📖 Dictionnaire** — accessible depuis le menu et en pleine partie :
  - `BONJOUR` → le mot est-il valable ?
  - `C?AT` → un `?` remplace une lettre
  - `PORT*` → toutes les rallonges de PORT
  - dans tous les cas, la liste des mots composables avec ces lettres, cliquables.
- **Définitions** — pour tout mot valable, et pour le mot solution à la fin de
  chaque problème. Voir plus bas.
- **Voir la solution** — affiche le meilleur coup sur la grille, et les suivants.
  Demande une confirmation ; le problème ne comptera pas comme résolu.

### Sauvegarde

Automatique et permanente. Fermez l'application au milieu d'un problème, revenez
trois jours plus tard : la grille, les jetons posés et le chronomètre sont
exactement où vous les aviez laissés (bouton **Reprendre la partie en cours**).

L'accueil retient, pour chaque niveau, le nombre de problèmes résolus et le
meilleur temps.

---

## Comment ça marche

### Le dictionnaire

**416 349 mots — l'ODS9 intégral**, l'édition en vigueur du 1ᵉʳ janvier 2024 au
31 décembre 2027. Aucun mot n'est écarté : ni les rares, ni les longs.

Ce nombre surprend si on a lu ailleurs que « l'ODS contient 68 000 mots ». Les
deux sont vrais et ne comptent pas la même chose : 68 000 est le nombre
d'**entrées** du dictionnaire papier, 416 349 le nombre de **formes jouables**
(chaque pluriel, féminin et forme conjuguée est un mot distinct sur le plateau).
C'est la seconde qui compte pour valider un coup.

Les mots sont stockés dans un automate acyclique minimal (DAWG) de **420 Ko** :
validité, anagrammes et motifs se répondent en mémoire, instantanément.

Répartition : 81 mots de 2 lettres, un sommet vers 10 lettres, et 9 221 mots de
plus de 15 lettres. Ces derniers ne tiennent pas sur le plateau et le solveur les
ignore de lui-même ; ils sont conservés pour que la consultation réponde juste
sur `ABASOURDISSAIENT`. Coût mesuré : 0,78 ms par appel au solveur au lieu de
0,36 ms — invisible à l'usage.

> L'ODS est une œuvre éditée par Larousse. La liste utilisée ici provient d'un
> dépôt public ; l'application est un usage privé et personnel.

### Pourquoi des mots de plus de 7 lettres

Le chevalet contient sept jetons, mais **un mot posé n'est pas limité à sept
lettres** : il s'appuie sur les lettres déjà présentes sur la grille. Poser
J-U-S-T-I-C-E en n'utilisant que six jetons parce qu'un `S` traînait au bon
endroit est un coup tout à fait ordinaire — c'est même l'un des exemples produits
par le générateur. Un mot peut atteindre 15 lettres, la largeur du plateau.

### Les définitions

Le DAWG ne stocke que l'existence d'un mot, pas son sens — c'est ce qui lui
permet de tenir en 420 Ko. Les définitions sont donc cherchées **à la demande**
sur le Wiktionnaire, puis mises en cache dans `data\definitions.json` : un mot
consulté une fois reste lisible hors ligne.

Trois obstacles ont dicté l'implémentation (`build\definitions.js`) :

1. **L'ODS écrit sans accent.** `ZEBRE` ne désigne aucune page. On cherche donc
   toutes les graphies accentuées et on les renvoie toutes — `ZEBRE` donne à la
   fois *zèbre* (le mammifère) et *zébré* (l'adjectif).
2. **Une page contient plusieurs langues.** Sans isoler la section française,
   `ZEBRE` renvoyait une étymologie… bretonne.
3. **La plupart des formes sont fléchies.** `IMAMS` ne donne que « Pluriel de
   imam » : on remonte au mot de base pour afficher « imam : guide de la
   communauté dans la religion musulmane », qui est ce que le joueur cherchait.

Mesuré sur un échantillon de mots de l'ODS, rares et fléchis compris :
**14 sur 14**. Compter ~1 s à la première consultation, ~50 ms ensuite.

### Mettre à jour la liste de mots

Au démarrage, l'application vérifie discrètement s'il existe une liste plus
récente. C'est **le seul accès réseau** du programme ; sans connexion, il ne dit
rien et tout continue de fonctionner.

⚠️ Il n'existe **pas d'API officielle** de l'ODS : ni la fédération ni Larousse
ne publient de liste lisible par une machine. La source est donc une liste tenue
par la communauté, déclarée dans `data\dict-source.json` et remplaçable par
n'importe quelle URL renvoyant soit une liste texte (un mot par ligne), soit le
format `const X="<gzip en base64>"`.

Rien n'est installé sans un clic, et la bascule est protégée :

1. la liste téléchargée est refusée si elle compte moins de 300 000 mots, si plus
   de 2 % des lignes sont inexploitables, s'il manque des mots témoins
   (`BONJOUR`, `MAISON`, `CHAT`…) ou si elle est plus de 5 % plus courte que
   l'actuelle ;
2. le nouveau dictionnaire est construit **dans un dossier à part** ;
3. il est **relu depuis le disque** et interrogé avant toute bascule ;
4. l'ancien est copié dans `data\dictionnaire-precedent\` ;
5. seulement alors les fichiers sont remplacés.

À la moindre erreur, rien n'est touché. Le bouton **Revenir à la liste
précédente** restaure l'ancienne version à tout moment.

En ligne de commande : `node build\build-dict.js --fetch`.

### Les problèmes

Les grilles ne sont pas fabriquées en posant des mots au hasard : le programme
**joue réellement une partie contre lui-même** avec le vrai sac de 102 jetons,
en choisissant des coups plausibles de joueur de salon (mots courants, scores
moyens). Il s'arrête à un tour choisi et distribue un dernier tirage pris dans ce
qui reste du sac.

Le solveur énumère alors **tous** les coups légaux (algorithme Appel & Jacobson :
ancres, contrôles croisés, extension gauche puis droite le long du DAWG) et le
problème n'est retenu que si le meilleur coup correspond au niveau demandé —
score, nombre de jetons, longueur, rareté du mot, et écart avec le deuxième
meilleur coup. Sinon, on retire un autre tirage.

D'où deux propriétés utiles : la grille ressemble toujours à une vraie partie, et
l'objectif affiché est réellement le maximum atteignable.

Comptez 70 à 260 ms par problème selon le niveau (Facile est le plus lent : ses
contraintes sont les plus serrées, donc il faut plus d'essais). Le solveur tourne
dans un *worker*, l'interface ne se fige jamais.

**Combien de problèmes différents ?** Chaque problème est fabriqué à la demande à
partir d'une graine aléatoire de 32 bits : environ **4,3 milliards de grilles par
niveau**, soit ~17 milliards en tout. Rien n'est stocké, il n'y a donc pas de
stock à épuiser. Statistiquement, il faudrait en jouer ~77 000 pour avoir une
chance sur deux de retomber une fois sur la même — à dix par jour, une vingtaine
d'années.

---

## Vérifier / modifier

```powershell
node test\test.js          # tests du moteur + calibrage des 4 niveaux
node test\completude.js 7  # le générateur oublie-t-il des coups ?
node build\build-dict.js   # reconstruit les dictionnaires binaires
node build\make-icon.js    # régénère app\icon.ico et app\icon.png
```

Deux vérifications se complètent :

**`test.js`** rejoue chaque coup produit par le générateur dans le vérificateur
de placement, écrit séparément, et exige le même score : une erreur de
multiplicateur ne peut pas passer les deux (1 600 coups contrôlés).

**`completude.js`** attaque le problème par l'autre bout. Il énumère les
placements **sans jamais appeler le générateur** — toutes les directions, toutes
les portions de ligne, tous les arrangements de jetons dans leurs cases vides —
et exige qu'aucun ne dépasse l'objectif affiché. C'est ce qui garantit qu'il
n'existe pas de coup meilleur que la « meilleure solution », ce que le premier
test ne prouve pas. Mesuré : **23,8 millions de placements** sur 12 problèmes,
la force brute retrouve exactement l'objectif à chaque fois. (Les tirages
contenant un joker sont écartés de cette recherche : les 26 substitutions
possibles la feraient exploser sans rien apprendre de neuf.)

Pour retoucher la difficulté, tout est dans l'objet `LEVELS` en tête de
`app\js\puzzle.js` (fourchette de score, nombre de jetons, longueur du mot,
obligation d'un mot courant, présence de jokers).

### Organisation

```
Scrabble.bat                       lanceur
server.js                          serveur local : fichiers, sauvegarde,
                                   mise à jour du dictionnaire. Sans dépendance.
app/
  index.html style.css
  js/ dawg.js                      lecture du dictionnaire binaire
      rules.js                     plateau, valeurs des lettres, sac français
      movegen.js                   génération et notation des coups
      puzzle.js                    fabrication et calibrage des problèmes
      worker.js                    moteur, hors du fil d'affichage
      ui.js                        interface
  data/ dict.bin common.bin        dictionnaires + manifeste
        dict-manifest.json
build/ wordsource.js               d'où viennent les mots, et leur validation
       build-dict.js               construction du DAWG
       mots-source.txt             dernière liste installée (cache)
       freq-raw.txt                fréquences, pour le classement courant/rare
data/ state.json                   sauvegarde (+ state.backup.json)
      dict-source.json             source du dictionnaire (optionnel)
      dictionnaire-precedent/      liste remplacée, pour le retour arrière
test/test.js
```

Une page **Comment ça marche** est intégrée à l'application (bouton sur
l'accueil) : elle explique le jeu sans aucun terme technique, et contient les
boutons de mise à jour du dictionnaire.

---

## Crédits

Ce dépôt ne contient que du code. Les données sont téléchargées à l'exécution
depuis :

- **[Thecoolsim/ODS9](https://github.com/Thecoolsim/ODS9)** — liste ODS9
  (416 349 formes), MIT, © Simon Adjatan. Sert de dictionnaire de jeu.
- **[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)** —
  fréquences du français d'après OpenSubtitles, MIT, © Hermit Dave. Sert
  uniquement à distinguer les mots courants des mots rares pour calibrer les
  niveaux ; ne décide jamais si un mot est autorisé.
- **[Wiktionnaire](https://fr.wiktionary.org)** — définitions, interrogées à la
  demande via l'API MediaWiki. Contenu sous licence
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr), ©
  les contributeurs du Wiktionnaire. Rien n'est redistribué ici : les
  définitions sont récupérées et mises en cache sur la machine de
  l'utilisateur.

*L'Officiel du jeu Scrabble* est une marque et une œuvre éditées par Larousse et
la Fédération internationale de Scrabble francophone, sans lien avec ce projet.

L'algorithme de génération de coups suit Appel & Jacobson, *The World's Fastest
Scrabble Program* (CACM, 1988). Le dictionnaire est un DAWG minimisé par
construction incrémentale (Daciuk et al., 2000).

SCRABBLE® est une marque déposée de Mattel et Hasbro selon les territoires.
Projet personnel, sans affiliation.

---

## Licence

[MIT](LICENSE) — pour le code de ce dépôt uniquement. Les listes de mots
téléchargées à l'exécution restent soumises aux droits de leurs auteurs et
éditeurs.
