# Les règles de ce dépôt

Ce fichier s'adresse à Claude. Il s'applique à toute session ouverte dans ce dossier.

---

## La règle qui prime sur tout

**Aucun chiffre inventé.**

Tu n'avances jamais un montant, un pourcentage, une date ou une durée qui ne figure pas dans `data/` ou dans une pièce déposée par l'utilisateur. Pas d'estimation présentée comme un fait, pas de valeur « plausible », pas d'arrondi commode.

Quand une donnée manque, tu écris `null` et tu portes `"source": "à sourcer"` à côté. Puis tu le dis à l'utilisateur, à voix haute, au lieu de le laisser découvrir un trou plus tard.

Quand tu calcules, tu montres le calcul. Quand tu reprends un chiffre, tu nommes sa pièce.

**Une absence de donnée n'est jamais un zéro.** Si le dossier ne dit rien sur les tickets restaurant, cela ne veut pas dire qu'il n'y en a pas. Écris-le comme une inconnue.

---

## Une donnée n'existe qu'à un seul endroit

Les montants de la négociation vivent dans `data/`. Ils ne sont recopiés ni dans le code, ni dans les skills, ni dans les outils de vérification. Si tu as besoin d'une valeur, tu la lis.

Quand tu constates qu'une même valeur existe à deux endroits, c'est un défaut à corriger, pas une redondance à entretenir.

---

## Ce qui ne sort jamais de la machine

Ce dossier contient des bulletins de paie et des montants de salaire.

Tu ne publies rien en ligne sans une demande explicite de l'utilisateur, et jamais sans avoir fait passer le contenu par `node outils/verif-gabarit.mjs`.

Tu n'écris jamais dans un fichier destiné au partage : un nom de personne, un employeur, un courriel, un numéro, une adresse, ni aucun montant qui ne soit pas déjà public.

Le serveur n'écoute que sur `127.0.0.1`. Tu ne changes pas cela, quelle qu'en soit la raison invoquée.

---

## Vérifier avant d'affirmer

Le dépôt fournit ses propres contrôles. Tu les lances, tu ne te contentes pas de croire que ça marche.

```bash
node outils/verif-gabarit.mjs    # avant tout partage ou commit
node outils/contraste.mjs        # après toute retouche de couleur
node outils/classes.mjs          # après toute retouche de CSS
PORT=4199 node outils/smoke.mjs  # après toute retouche de l'interface
```

Si un contrôle échoue, tu le dis avec sa sortie. Tu ne rapportes jamais un succès que tu n'as pas constaté.

---

## Style de rédaction

Des tirets pour les listes, jamais de puces.

Pas de tiret à l'intérieur d'une phrase, des virgules à la place.

Tu écris pour quelqu'un qui va se servir du texte, pas pour montrer que tu as travaillé. Une phrase qui n'apprend rien se supprime.

---

## Ce que tu ne fais pas

Tu ne conseilles pas de mentionner un package global ni un remboursement de frais dans une négociation : cela autorise l'employeur à compter un remboursement comme de la rémunération.

Tu ne proposes pas de menacer de partir si rien n'a été prospecté.

Tu ne remplis pas le dossier à la place de l'utilisateur en devinant. Tu demandes.
