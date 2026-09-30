<img src="logo.svg" alt="" width="96" align="right">

# Cockpit d'entretien

Un poste de travail local pour préparer un entretien annuel de rémunération, et surtout pour ne pas recommencer à zéro l'année suivante.

Il tient un dossier sourcé, il vous fait répéter la conversation avec un manager joué par Claude, il produit une fiche d'une page à remettre en séance, et il vérifie chacun de vos chiffres avant que vous ne les prononciez.

---

## Ce qu'il faut avant de commencer

**Claude Code, et un compte Claude.** Le cockpit ne contient aucun modèle et n'appelle aucune API. L'intelligence vient de votre session Claude Code : c'est elle qui lit vos pièces, remplit votre dossier, joue votre manager en répétition et rédige vos débriefs. Sans compte Claude, il vous reste une interface de suivi et des outils de vérification, ce qui est déjà utile mais représente peut-être la moitié de la valeur.

**Node 18 ou plus récent.** Rien d'autre.

---

## Vos données ne quittent jamais votre machine

C'est le choix d'architecture central, et il n'est pas négociable.

Le serveur n'écoute que sur `127.0.0.1`. Il n'y a **aucune dépendance de production**, aucun `npm install` pour démarrer, aucun compte à créer, aucun serveur distant, aucune télémétrie. Vos bulletins de paie et vos montants restent dans des fichiers, sur votre disque, que vous pouvez lire et éditer avec n'importe quel éditeur de texte.

`inbox/`, `export/` et `archive/` sont exclus de git par construction. Et `node outils/verif-gabarit.mjs` refuse de laisser passer un nom, un courriel, un IBAN ou un montant dans un dépôt destiné à être partagé.

---

## Démarrer

```bash
npm start
```

Puis ouvrir **http://127.0.0.1:4173**

Le cockpit démarre **vide**. C'est voulu : il ne vous montre rien que vous n'ayez renseigné, et chaque écran vide vous dit ce qu'il attend.

Pour le remplir, ouvrez Claude Code dans ce dossier et lancez :

```
/demarrer
```

Claude vous demande les pièces à déposer dans `inbox/`, vous pose les questions nécessaires, et remplit `data/`. **Il n'invente rien** : ce qui n'a pas de pièce reste `null`, marqué à sourcer, et il vous le dit.

---

## Comment ça marche

Les données vivent dans `data/*.json`, et c'est la **source de vérité unique**. L'interface les lit et les écrit, ces mêmes fichiers restent éditables à la main, et une modification faite d'un côté apparaît de l'autre au rafraîchissement.

| Fichier | Contenu |
| --- | --- |
| `data/config.json` | Qui vous êtes, votre employeur, vos modules. Le seul endroit où le logiciel apprend votre contexte |
| `data/profil.json` | Votre situation réelle, poste, classification, rémunération, contraintes |
| `data/cible.json` | Les trajectoires visées, leurs prérequis, jalons et **coût réel** |
| `data/actions.json` | Le plan d'action par horizon, et les habitudes hebdomadaires |
| `data/competences.json` | Auto-évaluation sur une échelle de 0 à 5, avec la preuve de chaque niveau |
| `data/realisations.json` | Le journal des faits datés, à tenir toute l'année et pas la veille |
| `data/engagements.json` | Les promesses reçues et leur devenir. Le fichier qui évite de se faire avoir deux fois |
| `data/offres.json` | Les offres du marché relevées, avec leur fourchette **annoncée** |
| `data/paie.json` | Vos bulletins, par liste blanche de champs, sans aucun identifiant |
| `data/exercices.json` | Les situations de l'exercice à choix |
| `data/entrainement.json` | Vos scores, écrits par l'application |
| `data/formulaire.json` | Les textes de votre formulaire d'entretien, d'un cycle à l'autre |
| `data/discussions.json` | Les analyses produites au fil des pièces déposées |

---

## Les trois skills

**`/demarrer`** conduit l'installation. Il liste les pièces à fournir, vous interroge, remplit `data/`, puis lance les contrôles et vous dit ce qui manque encore.

**`/train`** fait jouer votre manager par Claude, avec le tempérament que vous avez décrit et **seulement ce que votre manager sait réellement**. Il ignore votre montant cible, vos planchers et votre stratégie de repli : sans cette asymétrie, l'exercice vous apprendrait à céder. Il corrige chaque réplique sur quatre axes, ton, formulation, risque, et une reformulation prête à prononcer. Dites **débrief** à la fin : Claude note votre séance sur 20, phase par phase, et publie une page que vous relirez le matin de l'entretien.

**`/relire`** traite une pièce déposée dans `inbox/` de bout en bout : lecture, recoupement avec votre dossier, mise à jour du cockpit, rangement. Il se déclenche sur « relis », « check le doc », « je t'ai remis ». **L'inbox doit toujours finir vide.**

---

## L'entraînement, sans modèle

L'onglet **Entraînement** est un exercice à choix. Une réplique du manager, trois ou quatre réponses, une seule bonne. Chaque mauvaise porte le numéro de la faute correspondante, et le motif s'affiche au clic.

**Aucun modèle n'intervient.** Tout est écrit dans `data/exercices.json`, donc rien ne peut inventer un montant ni vous conseiller une faute. L'onglet fonctionne sans réseau et sans rien d'installé.

Le bilan compare votre série à la précédente et signale **ce qui revient d'une série à l'autre**. Une faute présente sur deux séries n'est pas une inattention, c'est un réflexe à défaire.

---

## Les modules

Le noyau ne suppose aucun pays et aucune convention collective. Ce qui est spécifique vit dans `modules/` et s'active dans `data/config.json`.

| Module | Ce qu'il apporte |
| --- | --- |
| `modules/france/` | Grilles conventionnelles, lecteur de bulletins de paie français, motifs de confidentialité du pays |
| `modules/employeur-exemple/` | Un préréglage d'entreprise. **Informations publiques uniquement**, chacune avec sa source |

Sans aucun module actif, le cockpit fonctionne. Il est simplement plus neutre.

---

## Vérifier

Tous les outils sont en lecture seule sauf mention contraire, et tous tournent sans dépendance.

```bash
node outils/verif-gabarit.mjs    # aucune donnée personnelle avant un partage
node outils/contraste.mjs        # contraste WCAG de la palette
node outils/classes.mjs          # couverture CSS
PORT=4199 node outils/smoke.mjs  # toutes les vues rendent, même à vide
```

**`verif-gabarit.mjs` avant chaque commit**, si vous versionnez votre dossier. Il produit volontairement des faux positifs : un faux positif coûte trente secondes de lecture, un faux négatif coûte votre confidentialité.

---

## La règle du projet

**Aucun chiffre inventé.**

Un montant, une fourchette de marché ou un prérequis n'apparaît qu'avec sa source : un bulletin, un avenant, une synthèse signée, une annonce publique. Tant qu'il n'y a pas de source, le champ reste `null` et s'affiche « à sourcer ».

Ce n'est pas du zèle. C'est ce qui fait qu'une demande est incontestable en séance, et un seul chiffre approximatif suffit à ouvrir un débat que vous n'avez rien à gagner à ouvrir.

Le corollaire vaut pour Claude : dans ce dépôt, il lui est interdit d'avancer un montant qui ne figure pas dans `data/`.

---

## Licence

Source ouverte à la lecture, **usage personnel autorisé**, redistribution et usage commercial sur autorisation écrite. Voir [LICENSE](LICENSE).

Concrètement, vous pouvez cloner ce dépôt et vous en servir pour préparer vos propres entretiens, y compris en le modifiant. Vous ne pouvez pas le redistribuer ni en tirer un service payant sans accord.

Ce logiciel ne fournit ni conseil juridique, ni conseil en ressources humaines, ni garantie de résultat. Il organise vos données et vos pièces, les décisions restent les vôtres.
