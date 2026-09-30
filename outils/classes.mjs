// Audit des classes : node outils/classes.mjs
//
// Le validateur de couleur ne dit rien de la mise en page, et Chrome est bloque
// par la politique de l'entreprise sur cette machine, donc pas de controle a
// l'oeil. Ce script remplace une partie de l'oeil : toute classe posee par
// l'interface doit avoir une regle, et toute regle doit servir a quelque chose.

import { readFile } from 'node:fs/promises';

const racine = (f) => new URL(`../${f}`, import.meta.url);
const app = await readFile(racine('public/app.js'), 'utf8');
const html = await readFile(racine('public/index.html'), 'utf8');
const css = await readFile(racine('public/style.css'), 'utf8');
const src = app + html;

// Classes posees en dur, plus celles construites a la volee, qu'un simple
// balayage de class="..." rate.
const posees = new Set();
for (const m of src.matchAll(/class="([^"]*)"/g)) {
  for (const c of m[1].split(/[\s${}]+/)) if (/^[a-z][a-z0-9-]*$/.test(c)) posees.add(c);
}
for (const m of src.matchAll(/classList\.(?:add|remove)\('([a-z0-9-]+)'\)/g)) posees.add(m[1]);
for (const m of src.matchAll(/'((?:prio|choix|repere|point|bulle|champ)-[a-z0-9]+)'/g)) posees.add(m[1]);
for (const m of src.matchAll(/\b(ok|gap|unknown|done|abandonne|primary|actif|current)\b(?=['"])/g)) posees.add(m[1]);

// Mots captures par le balayage mais qui ne sont pas des classes : morceaux de
// gabarits, noms de variables, elements HTML stylees sans classe.
const FAUX_POSITIFS = new Set([
  'classe', 'null', 's', 'body', 'label', 'value', 'titre', 'date', 'entry',
  'impact', 'note', 'nom', 'meta', 'size', 'week', 'tick', 'required', 'stack', 'page',
]);

const declarees = new Set();
for (const m of css.matchAll(/\.([a-z][a-z0-9-]*)/g)) declarees.add(m[1]);

const sansRegle = [...posees].filter((c) => !declarees.has(c) && !FAUX_POSITIFS.has(c)).sort();
const sansUsage = [...declarees].filter((c) => !posees.has(c) && !FAUX_POSITIFS.has(c)).sort();

console.log(`${posees.size} classes posees, ${declarees.size} declarees dans la feuille\n`);
console.log(`Posees sans regle   : ${sansRegle.length ? sansRegle.join(', ') : 'aucune'}`);
console.log(`Declarees sans usage: ${sansUsage.length ? sansUsage.join(', ') : 'aucune'}`);
console.log('\nUne classe declaree sans usage n\'est pas forcement morte : certaines sont');
console.log('construites par concatenation. Verifier avant de retirer.');

// Seul le premier cas est une vraie faute : une classe posee sans regle ne
// s'affiche pas comme prevu, et rien a l'ecran ne le signale.
process.exit(sansRegle.length ? 1 : 0);
