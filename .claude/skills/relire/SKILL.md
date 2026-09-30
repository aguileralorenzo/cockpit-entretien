---
name: relire
description: Traite une pièce déposée dans inbox/ de bout en bout, lecture, recoupement avec le dossier, mise à jour du cockpit, rangement. Se déclenche sur « relis », « check le doc », « je t'ai remis », « regarde le fichier », ou sur /relire.
---

# Traiter une pièce

L'utilisateur a déposé un document dans `inbox/`. Tu le traites **entièrement**, et tu ne t'arrêtes jamais à la lecture.

## Les sept étapes

**Un, trouver.** Liste `inbox/`, hors `traites/`. S'il y a plusieurs pièces, prends la plus récente et signale les autres. S'il n'y en a aucune, dis-le au lieu de chercher ailleurs.

**Deux, lire.** En entier. Pas la première page, pas le résumé.

**Trois, vérifier.** Recoupe chaque affirmation et chaque montant avec `data/`. C'est le cœur du travail, le reste en découle.

**Quatre, rendre compte.** Ce que la pièce change, ce qu'elle confirme, ce qu'elle contredit. Dans cet ordre, parce qu'une contradiction est ce qui coûte le plus cher à découvrir tard.

**Cinq, mettre à jour.** Écris dans `data/`, pas seulement dans ta réponse. Une analyse qui ne laisse pas de trace sera refaite.

**Six, ranger.** Déplace la pièce dans `inbox/traites/`. **L'inbox doit finir vide**, c'est le signal qu'il ne reste rien en attente.

**Sept, contrôler.** Lance les vérifications du dépôt et rapporte leur sortie.

---

## Ce qu'il faut chercher

**Les montants.** Chacun se recoupe avec le dossier. Un écart n'est pas forcément une erreur de la pièce, c'est parfois le dossier qui est périmé. Dis lequel des deux tu crois, et pourquoi.

**Les affirmations non sourcées.** Un document officiel peut affirmer sans prouver. Distingue ce qu'il **établit** de ce qu'il **prétend**.

**Les dates.** Une pièce peut être périmée sans le dire. Un export horodaté porte la date de l'export, pas celle des faits qu'il contient, et c'est un piège classique.

**Les engagements.** Toute promesse, même molle, va dans `data/engagements.json` avec sa date, son auteur et sa pièce. Un engagement sans échéance n'est pas un engagement, c'est une intention, et il faut l'écrire aussi.

**Ce que la pièce ne dit pas.** Souvent plus instructif que ce qu'elle dit. Une absence de donnée n'est jamais un zéro.

---

## Les fichiers à tenir à jour

| Ce que tu trouves | Où ça va |
|---|---|
| Un fait sur la situation | `data/profil.json` |
| Une promesse, tenue ou non | `data/engagements.json` |
| Un fait daté avec impact | `data/realisations.json` |
| Un montant de négociation | `data/negociation.json` |
| Un texte de formulaire | `data/formulaire.json` |
| Une chose à faire | `data/actions.json` |
| Ton analyse elle-même | `data/discussions.json` |

**Une donnée n'existe qu'à un seul endroit.** Si tu constates qu'un montant vit déjà ailleurs, ne le recopie pas, corrige la duplication.

---

## Les contrôles, à la fin

```bash
node outils/verif-gabarit.mjs
PORT=4199 node outils/smoke.mjs
```

Distingue une **vraie faute** d'un **faux positif de tes propres contrôles**. Un contrôle large produit du bruit, c'est voulu, et se taire sur le bruit est aussi grave que se taire sur une faute.

---

## La règle qui prime

**Aucun chiffre inventé.** Si la pièce ne porte pas un montant, tu ne le déduis pas. Tu écris ce qui manque et tu demandes la pièce qui le porterait.

---

## Style

Pas de puces, des tirets pour les listes. Aucun tiret à l'intérieur d'une phrase, des virgules à la place.
