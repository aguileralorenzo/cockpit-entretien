// Controle de la grille d'acceptation.
//
//   node outils/verif-acceptation.mjs
//
// La grille dit ce qu'on fait de la reponse quand elle tombe. Elle ne vaut que
// si chacune de ses bornes est un chiffre du dossier : une frontiere choisie a
// vue, meme de bonne foi, transformerait un seuil negocie en preference, et une
// preference se renegocie toute seule le jour ou on a envie d'en finir.
//
// Quatre choses sont verifiees.
//
// UN, chaque borne correspond au centime a un montant du dossier.
// DEUX, aucun pourcentage n'est stocke dans acceptation.json, ils doivent tous
// etre recalcules a l'affichage, sinon deux chiffres finissent par diverger.
// TROIS, les paliers se suivent sans trou ni recouvrement, sinon un montant
// reel pourrait ne tomber dans aucune ligne, ou dans deux.
// QUATRE, et c'est le plus important, la grille n'est pas PERIMEE : regenerer
// ne changerait rien. Un fichier qu'on peut oublier de regenerer n'est pas
// automatique, un fichier dont la peremption fait echouer le controle l'est.

import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = new URL('..', import.meta.url);
const lire = async (n) => JSON.parse(await readFile(new URL(`data/${n}.json`, RACINE), 'utf8'));

const [acc, negociation] = await Promise.all(['acceptation', 'negociation'].map((n) => lire(n).catch(() => null)));

const erreurs = [];
const ok = [];
const eur = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

console.log('Grille d acceptation\n');

/* ------------------------------------------------------------ dossier vide */

// L'etat normal d'un gabarit fraichement clone. On verifie quand meme que les
// textes sont la : ce sont eux qui donneront leur sens aux paliers le jour ou
// les montants arriveront.
if (!acc?.paliers?.length) {
  const textes = acc?.textes ?? [];
  console.log('  ok   aucun palier, les montants ne sont pas encore renseignes');
  if (textes.length >= 4) {
    console.log(`  ok   ${textes.length} textes de palier prets a servir`);
    console.log('\nRenseigne negociation.montants, puis lance node outils/faire-acceptation.mjs.');
    process.exit(0);
  }
  console.log(`\n  NON  seulement ${textes.length} texte(s) de palier, il en faut au moins quatre`);
  process.exit(1);
}

/* -------------------------------------------------------------- un, bornes */

const base = acc.base_mensuelle;
const m = negociation?.montants ?? {};

if (base !== m.actuel) erreurs.push(`base ${base} differente de negociation.montants.actuel ${m.actuel}`);
else ok.push(`base ${eur(base)}, conforme au dossier`);

const cent = (n) => Math.round(n * 100);
const produits = new Set();
for (const p of acc.paliers) {
  produits.add(cent(base + p.min));
  if (p.max != null) produits.add(cent(base + p.max));
}

// Chaque attendu est un SALAIRE relu depuis negociation.json, jamais recopie
// depuis acceptation.json : deux lectures de la meme source se contredisent
// moins souvent qu'une lecture et une copie.
const attendus = [
  ['plancher absolu', m.plancher_absolu],
  ['plancher de repli', m.plancher],
  ['cible', m.cible],
  ['demande annoncee', m.demande],
].filter(([, v]) => typeof v === 'number');

for (const [nom, salaire] of attendus) {
  // A un centime pres de part et d'autre : les paliers sont contigus au
  // centime, la borne haute d'un palier vaut donc la borne basse du suivant
  // moins un centime.
  const c = cent(salaire);
  if ([c - 1, c, c + 1].some((x) => produits.has(x))) ok.push(`${nom.padEnd(20)} ${eur(salaire)}`);
  else erreurs.push(`${nom} : aucun palier ne tombe sur ${eur(salaire)}`);
}

/* ------------------------------------------- deux, aucun pourcentage stocke */

if (/"taux|"pourcentage|"pct/.test(JSON.stringify(acc.paliers))) {
  erreurs.push('un pourcentage est stocke dans les paliers, il doit etre recalcule a l affichage');
} else {
  ok.push('aucun pourcentage stocke, tous recalcules depuis la base');
}

/* ------------------------------------------ trois, ni trou ni recouvrement */

const tries = [...acc.paliers].sort((a, b) => a.min - b.min);
let contigus = true;
if (tries[0].min !== 0) { erreurs.push('le premier palier ne part pas de 0'); contigus = false; }
for (let i = 1; i < tries.length; i += 1) {
  const p = tries[i];
  const q = tries[i - 1];
  if (q.max == null) { erreurs.push(`${q.id} est ouvert mais n'est pas le dernier palier`); contigus = false; continue; }
  const saut = cent(p.min) - cent(q.max);
  if (saut !== 1) {
    erreurs.push(`entre ${q.id} et ${p.id}, ${saut <= 0 ? 'recouvrement' : `trou de ${(saut - 1) / 100} EUR`}`);
    contigus = false;
  }
}
if (tries.at(-1).max !== null) { erreurs.push('le dernier palier devrait etre ouvert vers le haut'); contigus = false; }
if (contigus) ok.push(`${tries.length} paliers contigus, de 0 a ${eur(tries.at(-1).min)} et au-dela`);

// Chaque palier porte sa reaction, son commentaire et son action. Une case vide
// le jour ou la reponse arrive vaut une case absente.
for (const p of acc.paliers) {
  for (const champ of ['emoji', 'verdict', 'commentaire', 'action']) {
    if (!p[champ]) erreurs.push(`${p.id} : ${champ} manquant`);
  }
  // Un emoji, pas une suite de caracteres ASCII deguisee.
  if (p.emoji && ![...p.emoji].some((c) => c.codePointAt(0) > 0x2000)) {
    erreurs.push(`${p.id} : "${p.emoji}" n'est pas un vrai emoji`);
  }
}

/* -------------------------------------------- quatre, la grille est a jour */

// On delegue au generateur en mode controle plutot que de recalculer ici : deux
// implementations de la meme regle finissent toujours par diverger, et c'est
// alors le controle qui se tait quand il faudrait qu'il parle.
try {
  execFileSync(process.execPath, [fileURLToPath(new URL('faire-acceptation.mjs', import.meta.url)), '--controle'], {
    cwd: fileURLToPath(RACINE),
    stdio: 'pipe',
  });
  ok.push('grille a jour, regenerer ne changerait rien');
} catch (e) {
  const dit = `${e.stdout ?? ''}`.trim().split('\n').slice(1, -1).filter((l) => l.trim());
  erreurs.push('grille PERIMEE par rapport au dossier');
  for (const l of dit) erreurs.push(`  ${l.trim()}`);
  erreurs.push('  relance : node outils/faire-acceptation.mjs');
}

/* ---------------------------------------------------------------- resultat */

for (const l of ok) console.log(`  ok   ${l}`);
if (erreurs.length) {
  console.log('');
  for (const e of erreurs) console.log(`  NON  ${e}`);
  console.log(`\n${erreurs.length} probleme(s).`);
  process.exitCode = 1;
} else {
  console.log('\nToutes les bornes sont des chiffres du dossier.');
}
