// Controle d'une page de debrief AVANT publication.
//
//   node outils/verif-debrief.mjs <page.html>
//
// La page part en ligne. Trois choses y sont verifiees et aucune n'est negociable :
// la note se recalcule depuis les barres, la geometrie tient dans le cadre, et
// aucun montant hors dossier ni aucun nom propre n'y figure.

import { readFile } from 'node:fs/promises';
import { argv } from 'node:process';

const [, , chemin] = argv;
if (!chemin) throw new Error('usage : node outils/verif-debrief.mjs <page.html>');

const page = await readFile(chemin, 'utf8');
const erreurs = [];
const ok = (m) => console.log(`  ${m}`);

/* 1. La note se recalcule depuis ce qui est affiche ------------------------- */

const affichee = page.match(/<span class="chiffre">([\d,]+)<\/span>/);
if (!affichee) erreurs.push('note absente de la page');

const lignes = [...page.matchAll(/<span class="score [^"]*">(\d+) · (\d+) %<\/span>/g)]
  .map((m) => ({ note: +m[1], part: +m[2] }));

if (!lignes.length) erreurs.push('aucune phase listee');
else {
  const total = lignes.reduce((s, l) => s + l.part, 0);
  // Les parts sont affichees arrondies a l'entier, leur somme peut donc tomber a
  // 99 ou 101 sans que la note soit fausse. La somme exacte est verifiee plus bas
  // sur les parts portees par les barres, ou elle doit faire 100 au centieme.
  if (Math.abs(total - 100) > lignes.length * 0.5) erreurs.push(`les poids affiches font ${total} % au lieu de 100`);
  const calculee = lignes.reduce((s, l) => s + (l.note * l.part) / 100, 0);
  const lue = Number.parseFloat(affichee[1].replace(',', '.'));
  // Tolerance large pour la meme raison, l'arrondi des parts deplace la moyenne.
  if (Math.abs(calculee - lue) > 0.4) erreurs.push(`note affichee ${lue}, recalculee ${calculee.toFixed(2)} depuis les parts affichees`);
  else ok(`note ${lue} / 20 recalculee depuis les ${lignes.length} phases`);
  for (const l of lignes) if (l.note < 0 || l.note > 20) erreurs.push(`note de phase hors de 0 a 20 : ${l.note}`);
}

/* 2. La geometrie du graphique ---------------------------------------------- */

const svg = page.match(/<svg class="perf" viewBox="0 0 (\d+) (\d+)"[\s\S]*?<\/svg>/);
if (!svg) erreurs.push('graphique absent');
else {
  const W = +svg[1];
  const H = +svg[2];
  const T = 26;
  const BAS = 230;
  const gy = (v) => T + (1 - v / 20) * (BAS - T);

  // La barre porte sa part exacte, le texte affiche la part arrondie. C'est la
  // part exacte qui sert ici, sinon l'arrondi a l'entier fait echouer le controle
  // de largeur sur une seance partielle, ou les parts tombent sur 18,18 ou 36,36.
  const rects = [...svg[0].matchAll(/<rect class="barre[^"]*" data-part="([\d.]+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map((m) => ({ part: +m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] }));

  const sommeParts = rects.reduce((s, r) => s + r.part, 0);
  if (Math.abs(sommeParts - 100) > 0.01) erreurs.push(`les parts exactes font ${sommeParts.toFixed(2)} % au lieu de 100`);

  if (rects.length !== lignes.length) erreurs.push(`${rects.length} barres pour ${lignes.length} phases`);

  rects.forEach((r, i) => {
    const l = lignes[i];
    if (!l) return;
    // La hauteur doit dire la note, et le bas des barres doit etre commun.
    if (Math.abs(r.y - gy(l.note)) > 0.06) erreurs.push(`barre ${i + 1} : y=${r.y}, attendu ${gy(l.note).toFixed(1)} pour la note ${l.note}`);
    if (Math.abs(r.y + r.h - BAS) > 0.06) erreurs.push(`barre ${i + 1} : ne repose pas sur la ligne de base`);
    if (r.x < 41 || r.x + r.w > W - 13) erreurs.push(`barre ${i + 1} deborde du cadre`);
    if (r.y < 0 || r.y + r.h > H) erreurs.push(`barre ${i + 1} deborde en hauteur`);
    if (r.w <= 0 || r.h < 0) erreurs.push(`barre ${i + 1} de dimension invalide`);
  });

  // La largeur doit etre proportionnelle au poids, c'est tout l'interet du trace.
  const largeurTotale = rects.reduce((s, r) => s + r.w, 0);
  rects.forEach((r, i) => {
    const attendu = (largeurTotale * r.part) / 100;
    if (Math.abs(r.w - attendu) > 0.2) erreurs.push(`barre ${i + 1} : largeur ${r.w.toFixed(1)}, attendu ${attendu.toFixed(1)} pour ${r.part} %`);
    // La part affichee doit etre l'arrondi de la part reelle, sinon la liste
    // raconte autre chose que le graphique.
    const l = lignes[i];
    if (l && Math.abs(l.part - r.part) > 0.51) erreurs.push(`barre ${i + 1} : ${l.part} % affiche pour ${r.part} % reel`);
  });

  // Gouttieres de surface entre les barres, pour qu'elles se distinguent.
  for (let i = 1; i < rects.length; i += 1) {
    const g = rects[i].x - (rects[i - 1].x + rects[i - 1].w);
    if (g < 2 || g > 4) erreurs.push(`gouttiere ${i} de ${g.toFixed(1)} px`);
  }

  // Le rouge marque les phases sous la moyenne, et rien d'autre.
  const sous = [...svg[0].matchAll(/class="barre sous"/g)].length;
  const attendu = lignes.filter((l) => l.note < 10).length;
  if (sous !== attendu) erreurs.push(`${sous} barres en rouge pour ${attendu} phases sous 10`);

  // Chaque barre porte son chiffre, la couleur n'est jamais le seul signal.
  const vals = [...svg[0].matchAll(/<text class="val" x="[\d.]+" y="([\d.]+)">(\d+)<\/text>/g)];
  if (vals.length !== rects.length) erreurs.push(`${vals.length} etiquettes pour ${rects.length} barres`);
  vals.forEach((m, i) => {
    if (+m[1] < 8) erreurs.push(`etiquette ${i + 1} sort par le haut du cadre`);
    if (lignes[i] && +m[2] !== lignes[i].note) erreurs.push(`etiquette ${i + 1} affiche ${m[2]} au lieu de ${lignes[i].note}`);
  });

  if (!erreurs.length) ok(`graphique ${W}x${H}, ${rects.length} barres dans le cadre, largeurs proportionnelles aux poids`);
}

/* 3. Aucun montant hors dossier, aucun nom propre --------------------------- */

// toLocaleString('fr-FR') separe les milliers par une espace fine insecable,
// U+202F, et pas par une espace ordinaire. Sans cette normalisation le motif
// coupait un montant a quatre chiffres en deux et signalait des montants
// inexistants.
const plat = (s) => s.replace(/[    ]/g, ' ').trim();

// Les montants autorises viennent du dossier, pas d'une liste ecrite ici.
// Toute valeur declaree dans data/negociation.json peut figurer sur la page,
// aucune autre.
const RACINE = new URL('..', import.meta.url);
const nego = JSON.parse(await readFile(new URL('data/negociation.json', RACINE), 'utf8'));

const collecter = (v, acc = new Set()) => {
  if (typeof v === 'number' && Number.isFinite(v)) acc.add(v);
  else if (Array.isArray(v)) v.forEach((x) => collecter(x, acc));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (!k.startsWith('_')) collecter(x, acc); });
  return acc;
};

const chiffres = collecter(nego);
// Un ecart calcule est legitime sur la page meme s'il n'est pas stocke.
if (nego.montants?.demande != null && nego.montants?.actuel != null) {
  chiffres.add(nego.montants.demande - nego.montants.actuel);
}
const PERMIS = new Set([...chiffres].flatMap((n) => [
  n.toLocaleString('fr-FR'),
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2 }),
  String(n),
].map((s) => s.replace(/[\u00A0\u202F\u2009]/g, ' '))));

const normalisee = plat(page.replace(/[   ]/g, ' '));
const cites = [...new Set([...normalisee.matchAll(/(\d[\d ]*(?:,\d+)?)\s*€/g)].map((m) => plat(m[1])))];
const hors = cites.filter((v) => !PERMIS.has(v));
if (hors.length) erreurs.push(`montants hors dossier : ${hors.join(', ')}`);
else ok(`${cites.length} montants cites, tous dans le dossier`);

// Les noms a refuser viennent de data/config.json. Un gabarit fraichement clone
// n'en declare aucun, et c'est normal : le controle le dit plutot que de
// laisser croire qu'il a verifie quelque chose.
let NOMS = [];
try {
  const cfg = JSON.parse(await readFile(new URL('data/config.json', RACINE), 'utf8'));
  const id = cfg.identite ?? {};
  NOMS = [id.prenom, id.nom, id.employeur, ...(id.managers ?? []), ...(id.clients ?? []), ...(id.autres_motifs ?? [])]
    .filter((v) => typeof v === 'string' && v.trim().length > 2)
    .map((v) => ['nom declare en configuration', new RegExp(v.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]);
} catch { /* configuration illisible, on continue */ }

NOMS.push(['courriel', /[\w.+-]+@[\w-]+\.[a-z]{2,}/i]);

for (const [quoi, motif] of NOMS) {
  const m = page.match(motif);
  if (m) erreurs.push(`nom propre, ${quoi} : "${m[0]}"`);
}
if (!erreurs.some((e) => e.startsWith('nom propre'))) ok(`${NOMS.length} motifs de noms propres controles, aucun present`);

/* 4. Le contrat de page ------------------------------------------------------ */

if (/<!doctype|<html|<head>|<body>/i.test(page)) erreurs.push('la page redefinit le squelette');
if (!/^<title>/.test(page)) erreurs.push('titre absent ou pas en tete');
const racine = page.slice(page.indexOf(':root {'), page.indexOf('@media (prefers-color-scheme: dark)'));
for (const jeton of ['--fond', '--surface', '--carte', '--encre', '--filet', '--accent', '--tenu', '--lache']) {
  if (!racine.includes(jeton)) erreurs.push(`le jeton ${jeton} n est pas defini dans :root nu`);
}
if (!/:root:not\(\[data-theme="light"\]\)/.test(page)) erreurs.push('bloc sombre systeme non garde');
if (!/:root\[data-theme="dark"\]/.test(page)) erreurs.push('bloc sombre explicite absent');
if (!/body\s*\{[^}]*background: var\(--fond\)/.test(page)) erreurs.push('le body ne peint pas son fond');
const externes = [...new Set([...page.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).origin))];
for (const o of externes) if (!['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(o)) erreurs.push(`ressource externe non permise : ${o}`);
if (/<a[^>]+download/i.test(page)) erreurs.push('lien de telechargement, inerte dans le bac a sable');
ok(`contrat de page respecte, ressources externes : ${externes.join(', ')}`);
ok(`page de ${(Buffer.byteLength(page, 'utf8') / 1024).toFixed(1)} ko`);

console.log(erreurs.length ? `\n${erreurs.length} probleme(s) :\n  ${erreurs.join('\n  ')}` : '\nDebrief conforme, publiable.');
process.exit(erreurs.length ? 1 : 0);
