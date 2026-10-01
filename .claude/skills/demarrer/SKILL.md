---
name: demarrer
description: Installe le cockpit pour un nouvel utilisateur. Demande les pièces à déposer dans inbox/, conduit l'entretien de configuration, remplit data/ sans jamais rien inventer, puis lance les contrôles. À utiliser au premier lancement, ou quand l'utilisateur invoque /demarrer.
---

# Mise en route

Tu installes le cockpit pour quelqu'un qui vient de le cloner. À la fin, `data/` doit décrire sa situation réelle, et **rien d'autre**.

## La règle qui gouverne toute la session

**Tu n'inventes rien, et tu ne devines rien.**

Un champ sans pièce reste `null`, avec `"source": "à sourcer"` à côté. Tu le dis à voix haute plutôt que de le laisser découvrir plus tard.

Quand quelqu'un te donne un chiffre de mémoire, tu l'écris avec sa source réelle, « déclaré par l'utilisateur le <date> », et tu dis que ça vaut moins qu'un bulletin. Une estimation n'est pas un fait, et un dossier qui mélange les deux perd en séance.

---

## Étape 1, les pièces

Commence par là, toujours. **Un dossier sans pièces n'est qu'une opinion.**

Demande de déposer dans `inbox/` :

- **le contrat de travail et tous ses avenants**, c'est la base contractuelle
- **les douze derniers bulletins de paie**, trois au minimum
- **la synthèse du dernier entretien annuel**, signée si possible
- **toute promesse écrite non tenue**, quelle qu'en soit la forme, courriel compris
- **la convention collective applicable**, si elle est connue

Dis pourquoi chacune compte, en une ligne. Les gens fournissent ce dont ils comprennent l'usage.

**S'il n'y a aucune pièce**, tu peux continuer, mais annonce la conséquence : le dossier sera déclaratif, donc contestable, et il faudra y revenir.

---

## Étape 2, la configuration

Remplis `data/config.json`.

Prénom, nom, employeur, managers, clients. **Explique pourquoi tu les demandes** : ces noms ne servent pas à personnaliser l'interface, ils servent à être **refusés** dans tout document destiné à sortir de la machine. C'est `outils/verif-gabarit.mjs` qui s'en sert.

Le nom de l'outil RH et du cycle d'entretien, pour les libellés.

Les modules à activer. Propose `france` si la personne est en France.

---

## Étape 3, le dossier

Dans cet ordre, parce que chaque étape éclaire la suivante.

**La situation.** `data/profil.json`. Poste, date d'entrée, classification, rémunération actuelle, mission. Croise systématiquement avec les bulletins déposés : s'ils contredisent ce qui est déclaré, **dis-le tout de suite**, c'est souvent la découverte la plus utile de la séance.

**Le prochain entretien.** Sa date, son évaluateur, son cycle.

**L'engagement non tenu, s'il existe.** C'est la pièce la plus forte d'un dossier. Cite-la **mot pour mot**, avec sa date, son auteur et qui l'a signée. Une citation approximative ne vaut rien. Calcule l'écart entre ce qui était promis et ce qui a été appliqué, en montants et jamais en pourcentages.

**La demande.** `data/negociation.json`. Un seul chiffre, décomposé en parts qui s'additionnent. Demande sur quoi il se fonde et écris la réponse. Puis les planchers, en expliquant qu'ils ne se disent **jamais** à voix haute.

**Le repli.** Deux paliers datés. Rappelle la règle : on n'abaisse pas un montant, on l'étale.

**Le manager.** Fais choisir un archétype dans `modules/archetypes-manager.json`, en lisant à voix haute le « reconnaissable à » de chacun. Ajoute les traits observés. **Sépare rigoureusement ce qui est observé de ce qui est supposé** : les suppositions vont dans `suppositions_non_utilisables` et n'entreront jamais dans le jeu de rôle, parce qu'une conviction non fondée se transforme à l'oral en ressentiment.

**Ce que le manager sait.** La liste exhaustive. Tout ce qui n'y figure pas, il l'ignorera en répétition. C'est ce qui empêche l'exercice d'apprendre à céder.

**Les quatre écrits à obtenir.** Ce sans quoi la séance n'aura rien produit.

**La grille d'acceptation.** Une fois les montants posés, lance `node outils/faire-acceptation.mjs`. Elle calcule, palier par palier, ce que vaudra chaque réponse possible. Puis **fais relire les textes** : l'emoji, le commentaire et surtout la colonne « ce que tu fais » sont livrés rédigés, mais ils doivent devenir les siens. Un emoji qui ne correspond pas à ce qu'il ressentirait vraiment ne sert à rien, et une consigne qu'il n'a pas écrite ne sera pas suivie.

Explique pourquoi cette grille existe maintenant et pas le jour venu : la réponse arrivera avec son contexte, le ton de la personne en face, la fatigue, l'envie d'en finir. C'est dans ce moment-là qu'on accepte en quatre mots ce qu'on avait décidé de refuser.

---

## Étape 3 bis, les chiffres à savoir par cœur

`data/chiffres.json` arrive avec quinze questions universelles qui pointent vers son dossier. Dès l'étape 3 terminée, elles se résolvent toutes seules et le mode **Les chiffres** devient utilisable.

Ajoute-lui les siennes. Tout montant qu'il devra sortir sans hésiter mérite une ligne, et **toute ligne doit pointer vers le dossier plutôt que porter sa réponse** : une valeur recopiée finit toujours par diverger de sa source, et c'est le chiffre faux qui sortira en séance.

---

## Étape 4, le reste, quand il y a de la matière

`data/realisations.json`, `data/competences.json`, `data/cible.json`, `data/actions.json`, `data/engagements.json`. Ne force pas : mieux vaut trois réalisations sourcées que treize inventées.

Propose d'ajouter deux ou trois situations d'entraînement propres au dossier, à la suite des sept universelles de `data/exercices.json`.

---

## Étape 5, les contrôles, et ce qui manque

```bash
node outils/verif-gabarit.mjs
PORT=4199 node outils/smoke.mjs
```

Puis **dis ce qui manque**, franchement et par ordre d'importance. Un dossier incomplet n'est pas un échec, c'est un état : ce qui compte est de savoir où sont les trous.

Termine par les trois ou quatre actions concrètes à mener avant l'entretien, avec leur date.

---

## Style

Pas de puces, des tirets pour les listes. Aucun tiret à l'intérieur d'une phrase, des virgules à la place.

Une question à la fois. Un formulaire de trente champs fait abandonner, une conversation non.
