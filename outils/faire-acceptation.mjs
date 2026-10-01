// Regenere la grille d'acceptation depuis le dossier.
//
//   node outils/faire-acceptation.mjs [--verbeux] [--controle]
//
// A lancer apres chaque entretien, et apres toute modification d'un seuil, d'un
// salaire ou de l'echeance attendue. La grille dit ce qu'on fait de la reponse
// quand elle tombe : si une de ses bornes ne correspond plus au dossier, elle
// conseille a cote, et elle le fait en silence.
//
// CE QUI EST CALCULE et ce qui ne l'est pas, c'est toute la question.
//
// Les BORNES sont calculees. Chacune est un chiffre du dossier, aucune n'est
// choisie, et c'est ce qui rend la grille opposable a soi-meme le jour ou on
// voudra s'arranger avec.
//
// Les TEXTES ne le sont pas. L'emoji, le verdict, le commentaire, l'action et
// la phrase disent ce qu'on ressent et ce qu'on fait, aucun calcul ne produit
// cela. Ils sont repris tels quels, apparies par identifiant de palier, et un
// palier sans texte est signale plutot qu'invente.
//
// L'outil est idempotent. Lance deux fois de suite, le second passage ne change
// rien, et outils/verif-acceptation.mjs s'en sert pour refuser une grille
// perimee : un fichier qu'on peut oublier de regenerer n'est pas automatique,
// un fichier dont la peremption fait echouer le controle l'est.

import { readFile, writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

const RACINE = new URL('..', import.meta.url);
const chemin = (n) => new URL(`data/${n}.json`, RACINE);
const lire = async (n) => JSON.parse(await readFile(chemin(n), 'utf8'));

const verbeux = argv.includes('--verbeux');
// En controle, on calcule tout mais on n'ecrit rien, et le code de sortie dit
// si la grille est perimee.
const controle = argv.includes('--controle');

const [profil, negociation, engagements, ancien] = await Promise.all(
  ['profil', 'negociation', 'engagements', 'acceptation'].map((n) => lire(n).catch(() => null)),
);

const DOC =
  "Ce que vaut chaque reponse possible, decide a froid avant qu'elle ne tombe. Les pourcentages ne sont PAS stockes ici, ils sont recalcules a l'affichage depuis la base. Les montants sont des HAUSSES MENSUELLES BRUTES, pas des salaires.";
const POURQUOI =
  "Une grille ecrite a froid ne se renegocie pas dans l'emotion du jour ou la reponse arrive. C'est la difference entre savoir ce qu'on veut et le decouvrir en l'entendant.";

/* ---------------------------------------------------------------- sources */

// LA SEULE FONCTION A CHANGER D'UN DEPOT A L'AUTRE, si tu ranges tes montants
// ailleurs. Ici ils sont a plat dans negociation.montants, qui est le seul
// endroit ou ils existent.
//
// Un seuil absent n'est pas une erreur : sa bande ne sera simplement pas
// produite, et les voisines se recoudront. Une grille a quatre paliers vaut
// mieux qu'une grille a huit dont quatre frontieres sont inventees.
function lireMontants() {
  const n = negociation?.montants ?? {};
  const r = profil?.remuneration ?? {};
  return {
    base: n.actuel ?? null,
    sourceBase: 'negociation.montants.actuel',
    avant: r.avant_derniere_revalorisation?.brut_bulletin_mensuel ?? null,
    moyenneMaison: r.moyenne_augmentations_entreprise?.taux_pct ?? null,
    plancherAbsolu: n.plancher_absolu ?? null,
    plancher: n.plancher ?? null,
    cible: n.cible ?? null,
    demande: n.demande ?? null,
  };
}

const m = lireMontants();
// Un dossier vide est l'etat normal d'un gabarit fraichement clone, pas une
// erreur. On le dit et on sort proprement, sinon le controle groupe echouerait
// des le premier lancement et apprendrait a l'adoptant a ignorer ses alertes.
if (m.base == null) {
  console.log('Grille non produite : renseigne d abord negociation.montants.actuel.');
  console.log('Les textes des huit paliers sont deja ecrits, ils t attendent dans data/acceptation.json.');
  process.exit(0);
}

/* ----------------------------------------------------------------- seuils */

// Tout se compte en centimes jusqu'au dernier moment, sinon des bornes
// contigues se mettent a se recouvrir d'un millieme d'euro.
const cent = (n) => Math.round(n * 100);
const euros = (c) => c / 100;
const base = cent(m.base);
const eur = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Les seuils, exprimes en hausse mensuelle depuis la base. Un seuil que le
// dossier ne permet pas de calculer vaut null : sa bande disparait et les
// voisines se recousent, plutot que de poser une frontiere inventee.
const SEUILS = {
  moyenne: m.moyenneMaison == null ? null : {
    valeur: Math.round(base * (m.moyenneMaison / 100)),
    source: `${m.moyenneMaison} % de ${eur(m.base)}, moyenne des augmentations declaree`,
  },
  recu: m.avant == null ? null : {
    valeur: base - cent(m.avant),
    source: `hausse reellement percue, ${eur(m.avant)} vers ${eur(m.base)}`,
  },
  plancherAbsolu: m.plancherAbsolu == null ? null : {
    valeur: cent(m.plancherAbsolu) - base,
    source: `plancher absolu ${eur(m.plancherAbsolu)}`,
  },
  plancher: m.plancher == null ? null : {
    valeur: cent(m.plancher) - base,
    source: `plancher de repli ${eur(m.plancher)}`,
  },
  cible: m.cible == null ? null : {
    valeur: cent(m.cible) - base,
    source: `cible ${eur(m.cible)}`,
  },
  demande: m.demande == null ? null : {
    valeur: cent(m.demande) - base,
    source: `demande annoncee ${eur(m.demande)}`,
  },
};

/* ----------------------------------------------------------------- bandes */

// Le role que joue le seuil de chaque bande.
//
// En dessous du plancher absolu, un seuil FERME une bande : la reponse y est
// insuffisante et le seuil dit jusqu'ou. A partir du plancher absolu, le seuil
// OUVRE la bande : c'est le montant a partir duquel la reponse change de
// nature. Cette bascule est le coeur de la grille, et c'est pour cela que le
// plancher absolu apparait deux fois, comme fin d'une bande et debut de la
// suivante.
const BANDES = [
  { id: 'p0', borne: null, role: 'zero' },
  { id: 'p1', borne: 'moyenne', role: 'plafond' },
  { id: 'p2', borne: 'recu', role: 'plafond' },
  { id: 'p3', borne: 'plancherAbsolu', role: 'plafond-1' },
  { id: 'p4', borne: 'plancherAbsolu', role: 'plancher' },
  { id: 'p5', borne: 'plancher', role: 'plancher' },
  { id: 'p6', borne: 'cible', role: 'plancher' },
  { id: 'p7', borne: 'demande', role: 'plancher' },
];

const retenues = BANDES.filter((b) => b.role === 'zero' || SEUILS[b.borne]);
const absents = [...new Set(BANDES.filter((b) => b.borne && !SEUILS[b.borne]).map((b) => b.borne))];

// Premiere passe, les bornes basses. Le curseur avance d'un centime apres
// chaque bande fermee, pour qu'un montant reel tombe dans une ligne et une seule.
let curseur = 0;
const calculees = retenues.map((b) => {
  const s = b.borne ? SEUILS[b.borne] : null;
  if (b.role === 'zero') {
    curseur = 1;
    return { ...b, min: 0, max: 0, source: 'aucune revalorisation' };
  }
  if (b.role === 'plafond') {
    const min = curseur;
    curseur = s.valeur + 1;
    return { ...b, min, max: s.valeur, source: `borne haute, ${s.source}` };
  }
  if (b.role === 'plafond-1') {
    const min = curseur;
    curseur = s.valeur;
    return { ...b, min, max: s.valeur - 1, source: `borne haute, un centime sous le ${s.source}` };
  }
  curseur = s.valeur;
  return { ...b, min: s.valeur, max: null, source: `borne basse, ${s.source}` };
});

// Seconde passe, les bornes hautes des bandes ouvertes par leur seuil. La
// derniere reste ouverte, il n'y a rien au-dessus de la demande.
for (let i = 0; i < calculees.length - 1; i += 1) {
  if (calculees[i].max === null) calculees[i].max = calculees[i + 1].min - 1;
}

// Une bande vide n'apprend rien et casserait la contiguite. Elle survient quand
// deux seuils se rejoignent, par exemple si la moyenne vaut exactement ce qui a
// deja ete percu.
const vides = calculees.filter((b) => b.max !== null && b.min > b.max);
const bandes = calculees.filter((b) => b.max === null || b.min <= b.max);

for (let i = 1; i < bandes.length; i += 1) {
  if (bandes[i - 1].max !== null && bandes[i].min !== bandes[i - 1].max + 1) {
    console.log(`Les seuils ne sont plus ordonnes entre ${bandes[i - 1].id} et ${bandes[i].id}.`);
    console.log('Verifie les planchers, la cible et la demande avant de regenerer.');
    process.exit(1);
  }
}

/* -------------------------------------------------------------- echeance */

// La date attendue vient du registre et non d'une saisie : c'est l'engagement
// en attente le plus recent qui porte une echeance datee. Consigner un
// entretien puis regenerer suffit donc a mettre la grille a jour.
const attendu = (engagements?.engagements ?? [])
  .filter((e) => e.statut === 'en_attente' && /^\d{4}-\d{2}-\d{2}$/.test(e.echeance_annoncee ?? ''))
  .sort((a, b) => (b.date_engagement ?? '').localeCompare(a.date_engagement ?? ''))[0];

/* ---------------------------------------------------------------- textes */

const EDITORIAL = ['emoji', 'verdict', 'commentaire', 'action', 'phrase'];
const anciens = new Map((ancien?.paliers ?? []).map((p) => [p.id, p]));
// Le gabarit livre ses textes a part, dans `textes`, puisque ses paliers sont
// vides tant qu'aucun montant n'est saisi. Ici les deux sources se valent.
const reserve = new Map((ancien?.textes ?? []).map((t) => [t.id, t]));
const sansTexte = [];

const paliers = bandes.map((b) => {
  const a = anciens.get(b.id) ?? reserve.get(b.id) ?? {};
  const manque = EDITORIAL.filter((c) => !a[c]);
  if (manque.length) sansTexte.push(`${b.id} : ${manque.join(', ')}`);
  return {
    id: b.id,
    min: euros(b.min),
    max: b.max === null ? null : euros(b.max),
    emoji: a.emoji ?? null,
    verdict: a.verdict ?? null,
    commentaire: a.commentaire ?? null,
    action: a.action ?? null,
    phrase: a.phrase ?? null,
    borne_source: b.source,
  };
});

const sortie = {
  _doc: ancien?._doc ?? DOC,
  _pourquoi: ancien?._pourquoi ?? POURQUOI,
  _genere:
    'Les bornes et la base sont PRODUITES par outils/faire-acceptation.mjs depuis le dossier. Ne les modifie pas a la main, elles seraient ecrasees et le controle les refuserait. Les textes, eux, sont editoriaux : ils se modifient ici et le generateur les conserve.',
  base_mensuelle: m.base,
  source_base: m.sourceBase,
  attendu_le: attendu?.echeance_annoncee ?? null,
  source_attendu: attendu
    ? `Echeance de l engagement ${attendu.id}, ${attendu.source ?? 'registre des engagements'}`
    : null,
  paliers,
};
if (ancien?.textes) sortie.textes = ancien.textes;

/* -------------------------------------------------------------- ecriture */

const texteAvant = ancien ? `${JSON.stringify(ancien, null, 2)}\n` : '';
const texteApres = `${JSON.stringify(sortie, null, 2)}\n`;

// Ce qui a bouge, et seulement cela. Un generateur qui annonce « ecrit » sans
// dire quoi oblige a relire le fichier pour savoir s'il a fait quelque chose.
const bouges = [];
if (ancien && ancien.base_mensuelle !== sortie.base_mensuelle) bouges.push(`base ${ancien.base_mensuelle} -> ${sortie.base_mensuelle}`);
if (ancien && ancien.attendu_le !== sortie.attendu_le) bouges.push(`echeance ${ancien.attendu_le ?? 'aucune'} -> ${sortie.attendu_le ?? 'aucune'}`);
for (const p of paliers) {
  const a = anciens.get(p.id);
  if (!a) { bouges.push(`${p.id} nouveau`); continue; }
  if (a.min !== p.min || a.max !== p.max) bouges.push(`${p.id} ${a.min} a ${a.max ?? '+'} -> ${p.min} a ${p.max ?? '+'}`);
}
for (const id of anciens.keys()) if (!paliers.some((p) => p.id === id)) bouges.push(`${id} retire`);

const identique = texteAvant === texteApres;

if (controle) {
  if (identique) {
    console.log('Grille a jour, ses bornes correspondent au dossier.');
  } else {
    console.log('GRILLE PERIMEE. Le dossier a change depuis la derniere generation.');
    for (const l of bouges.length ? bouges : ['la mise en forme du fichier']) console.log(`  ${l}`);
    console.log('\nLance : node outils/faire-acceptation.mjs');
    process.exitCode = 1;
  }
} else if (identique) {
  console.log('Grille inchangee, ses bornes correspondent deja au dossier.');
} else {
  await writeFile(chemin('acceptation'), texteApres, 'utf8');
  console.log(`Grille regeneree, ${paliers.length} paliers.`);
  for (const l of bouges.length ? bouges : ['mise en forme seulement']) console.log(`  ${l}`);
}

for (const b of absents) console.log(`  seuil absent du dossier, bande non produite : ${b}`);
for (const b of vides) console.log(`  bande vide, deux seuils se rejoignent : ${b.id}`);
for (const l of sansTexte) console.log(`  A ECRIRE, ${l}`);

if (verbeux) {
  console.log('\nLes paliers :');
  const pc = (c) => `${((c / m.base) * 100).toFixed(2)} %`;
  for (const p of paliers) {
    console.log(`  ${p.id}  ${String(p.min).padStart(8)} a ${String(p.max ?? '+').padStart(8)}  ${pc(p.min).padStart(8)}  ${p.emoji ?? '?'}  ${p.borne_source}`);
  }
}

if (sansTexte.length) process.exitCode = 1;
