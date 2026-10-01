// Repond dans la repetition en direct, depuis Claude Code.
//
//   node outils/repondre-direct.mjs '<json>'
//
// Le json est un tableau de messages a ajouter, par exemple :
//   [{"qui":"manager","texte":"..."},
//    {"qui":"correction","ton":"...","formulation":"...","risque":null,"mieux":"..."}]
//
// L'ecriture baisse `attente`, ce qui rend la main a l'interface et reactive
// la zone de saisie. C'est tout le protocole : un drapeau et un tableau.

import { readFile, writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

const F = new URL('../data/echange.json', import.meta.url);
const charge = argv[2];
if (!charge) throw new Error('usage : node outils/repondre-direct.mjs \'[{"qui":"manager","texte":"..."}]\'');

const ajouts = JSON.parse(charge);
if (!Array.isArray(ajouts)) throw new Error('la charge doit etre un tableau de messages');

const e = JSON.parse(await readFile(F, 'utf8'));
const at = new Date().toISOString();
e.messages = [...(e.messages ?? []), ...ajouts.map((m) => ({ ...m, at }))];
e.attente = false;
e.session = { ...(e.session ?? {}), active: true };

await writeFile(F, `${JSON.stringify(e, null, 2)}\n`, 'utf8');

const quoi = ajouts.map((m) => m.qui).join(' puis ');
console.log(`ajoute : ${quoi} | ${e.messages.length} messages au total | attente rendue a false`);
