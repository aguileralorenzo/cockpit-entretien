// Refuse toute trace personnelle dans le depot.
//
//   node outils/verif-gabarit.mjs
//
// A LANCER AVANT CHAQUE COMMIT. Ce depot est destine a etre publie et partage.
// Un gabarit qui emporterait par accident des bulletins de paie, un nom ou un
// salaire serait une faute irrattrapable, et c'est le risque numero un du
// projet.
//
// Le controle est volontairement plus large que necessaire et produit des faux
// positifs. Un faux positif coute trente secondes de lecture, un faux negatif
// coute la confidentialite de quelqu'un.

import { readdir, readFile, stat } from 'node:fs/promises';

const RACINE = new URL('..', import.meta.url);

// Ce qu'on ne parcourt pas. inbox et export sont exclus de git par construction,
// node_modules n'est pas a nous, .git contient l'historique et pas l'etat.
const IGNORES = new Set(['.git', 'node_modules', 'inbox', 'export', 'archive']);

// Les fichiers autorises a contenir des chiffres et des exemples, parce que
// c'est leur travail. Ils restent controles pour les donnees personnelles.
const EXEMPLES = new Set(['data/exercices.json', 'README.md', 'DEMARRAGE.md', 'CLAUDE.md']);

// Le controleur enonce tous les motifs, il ne peut pas se controler lui-meme.
const SOI = 'outils/verif-gabarit.mjs';

/* -- les motifs -------------------------------------------------------------- */

// Universels. Ils ne dependent d'aucun utilisateur et ne bougeront jamais.
const UNIVERSELS = [
  ['numero de securite sociale', /\b[12]\s?\d{2}\s?(0[1-9]|1[0-2])\s?\d{2,3}\s?\d{3}\s?\d{3}(\s?\d{2})?\b/],
  ['IBAN', /\b[A-Z]{2}\d{2}\s?(?:[A-Z0-9]{4}\s?){3,7}[A-Z0-9]{1,4}\b/],
  ['carte bancaire', /\b(?:\d{4}[ -]?){3}\d{4}\b/],
  ['courriel', /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
  ['telephone francais', /\b0[1-9](?:[ .-]?\d{2}){4}\b/],
  ['code postal suivi d une ville', /\b\d{5}\s+[A-ZÉÈÀÂÎÔÛ][A-Za-zÉÈÀÂÎÔÛéèàâîôûç-]{2,}/],
  ['voie postale', /\b\d{1,4}\s*,?\s*(?:rue|avenue|boulevard|bd|cours|chemin|impasse|all[ée]e|route|rte|place)\s+[A-ZÉÈ]/i],
  ['matricule', /\bmatricule\s*n?o?\s*[:\s]\s*\d+/i],
  ['date de naissance', /\bné\(?e?\)?\s+le\b|\bdate de naissance\b/],
  ['chemin absolu utilisateur', /[A-Z]:[\\/]Users[\\/][A-Za-z]/],
  ['chemin absolu home', /\/(?:home|Users)\/[a-z][a-z.-]{2,}\//],
];

// Tout ce qui ressemble a un montant de salaire. Un gabarit n'en contient
// aucun : les exemples parlent de « ton montant », jamais d'un nombre.
const MONTANTS = [
  ['montant en euros', /\b\d{1,3}(?:[    ]\d{3})+(?:,\d{2})?\s*(?:€|EUR|euros)/],
  ['montant a quatre chiffres suivi d un symbole', /\b\d{4,6}(?:[.,]\d{2})?\s*(?:€|EUR\b)/],
  // Sans symbole. Les deux motifs ci-dessus exigeaient un € ou un EUR, si bien
  // qu'un montant ecrit seul dans un commentaire ou dans un tableau de test
  // passait au travers. C'est arrive, et c'est la forme sous laquelle un
  // montant se glisse le plus facilement dans du code.
  //
  // La negative derriere ecarte le 400 de « HTTP/1.1 400 », ou le groupe de
  // mille est precede d'un point ou d'une barre. Celle de devant ecarte le
  // « 1 100 » de « flex: 1 1 100% » : un pourcentage n'est pas un salaire.
  //
  // Les deux sont etroites a dessein. Un controle qui crie a chaque lancement
  // apprend a etre ignore, et c'est le moyen le plus sur de rater une vraie fuite.
  ['montant sans symbole', /(?<![.\/\d])\b\d{1,3}[  ]\d{3}\b(?![\d%])/],
];

// Un dessin n'a pas de salaire : les coordonnees d'un viewBox ressemblent a des
// montants sans symbole, et les controler ne protegerait personne. Les autres
// motifs, eux, continuent de s'appliquer aux images.
const SANS_MONTANTS = /\.svg$/;

/* -- parcours ----------------------------------------------------------------- */

const fichiers = [];
const parcourir = async (dir, rel = '') => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (IGNORES.has(e.name)) continue;
    const chemin = `${rel}${e.name}`;
    if (e.isDirectory()) await parcourir(new URL(`${e.name}/`, dir), `${chemin}/`);
    else fichiers.push({ url: new URL(e.name, dir), rel: chemin });
  }
};
await parcourir(RACINE);

/* -- configuration, pour les motifs nominatifs -------------------------------- */

// Si l'utilisateur a deja rempli sa configuration, ses propres noms deviennent
// des motifs interdits eux aussi. Un gabarit fraichement clone n'en a aucun,
// c'est normal, et le message le dit plutot que de laisser croire au controle.
let nominatifs = [];
try {
  const c = JSON.parse(await readFile(new URL('data/config.json', RACINE), 'utf8'));
  const id = c.identite ?? {};
  nominatifs = [id.prenom, id.nom, id.employeur, ...(id.managers ?? []), ...(id.clients ?? []), ...(id.autres_motifs ?? [])]
    .filter((v) => typeof v === 'string' && v.trim().length > 2)
    .map((v) => [`nom declare dans config`, new RegExp(v.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]);
} catch { /* pas de config lisible, on continue avec les seuls universels */ }

/* -- controle ------------------------------------------------------------------ */

const trouvailles = [];
let lus = 0;
let octets = 0;

const BINAIRES = /\.(png|jpe?g|gif|webp|pdf|zip|ico|woff2?|ttf|otf|mp4)$/i;

for (const f of fichiers) {
  if (BINAIRES.test(f.rel)) {
    trouvailles.push({ fichier: f.rel, quoi: 'fichier binaire', extrait: 'a verifier a la main, un binaire peut porter des metadonnees' });
    continue;
  }
  const info = await stat(f.url);
  if (info.size > 2_000_000) {
    trouvailles.push({ fichier: f.rel, quoi: 'fichier volumineux', extrait: `${(info.size / 1024 / 1024).toFixed(1)} Mo, suspect dans un gabarit` });
    continue;
  }
  const texte = await readFile(f.url, 'utf8');
  lus += 1;
  octets += info.size;

  if (f.rel === SOI) continue;
  const sansMontants = EXEMPLES.has(f.rel) || SANS_MONTANTS.test(f.rel);
  const motifs = [...UNIVERSELS, ...nominatifs, ...(sansMontants ? [] : MONTANTS)];
  for (const [quoi, motif] of motifs) {
    const m = texte.match(motif);
    if (!m) continue;
    const ligne = texte.slice(0, m.index).split('\n').length;
    trouvailles.push({ fichier: `${f.rel}:${ligne}`, quoi, extrait: m[0].slice(0, 60) });
  }
}

/* -- rapport -------------------------------------------------------------------- */

console.log(`${lus} fichiers lus, ${(octets / 1024).toFixed(0)} ko`);
console.log(`${UNIVERSELS.length} motifs universels, ${MONTANTS.length} motifs de montants, ${nominatifs.length} motifs nominatifs issus de la configuration`);
if (!nominatifs.length) console.log('  aucun nom declare dans data/config.json, seuls les motifs universels s appliquent');

if (!trouvailles.length) {
  console.log('\nGabarit propre, aucune trace personnelle.');
  process.exit(0);
}

console.log(`\n${trouvailles.length} chose(s) a verifier :`);
for (const t of trouvailles) console.log(`  ${t.fichier}\n    ${t.quoi} : ${t.extrait}`);
console.log('\nCe controle produit des faux positifs, c est voulu. Relis chaque ligne avant de commiter.');
process.exit(1);
