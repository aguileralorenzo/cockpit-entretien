// Archive l'echange en direct dans data/repetitions.json, pour qu'il soit
// rejouable dans l'onglet Repetitions.
//
//   node outils/archiver-direct.mjs [difficulte]
//
// Le canal data/echange.json est un tampon : il ne garde qu'une conversation a
// la fois et le bouton Nouvelle seance l'efface. Cet outil en fait une entree
// durable avant de repartir.

import { readFile, writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

const RACINE = new URL('..', import.meta.url);
const E = new URL('data/echange.json', RACINE);
const R = new URL('data/repetitions.json', RACINE);

const e = JSON.parse(await readFile(E, 'utf8'));
if (!e.messages?.length) throw new Error('le canal est vide, rien a archiver');

const r = JSON.parse(await readFile(R, 'utf8'));
r.repetitions = r.repetitions ?? [];

const jour = new Date().toISOString().slice(0, 10);
const rang = r.repetitions.filter((x) => x.date === jour).length + 1;
const id = `r${jour}-${'abcdefgh'[rang - 1] ?? rang}`;

if (r.repetitions.some((x) => x.id === id)) throw new Error(`${id} existe deja`);

// On recopie les echanges tels quels. La correction garde ses quatre axes, la
// replique garde son texte NON CORRIGE : c'est ce qui permet de voir
// d'une seance a l'autre ce qui revient.
r.repetitions.push({
  id,
  date: jour,
  difficulte: argv[2] ?? e.session?.difficulte ?? 'non précisée',
  note: null,
  debrief: null,
  corrige_en_direct: true,
  echanges: e.messages.map(({ at, ...m }) => m),
});

await writeFile(R, `${JSON.stringify(r, null, 2)}\n`, 'utf8');

const n = (q) => e.messages.filter((m) => m.qui === q).length;
console.log(`${id} archivee : ${n('moi')} repliques, ${n('correction')} corrections, ${e.messages.length} messages`);
console.log(`${r.repetitions.length} repetition(s) au total, relisibles dans l'onglet Entrainement, mode Les seances`);
