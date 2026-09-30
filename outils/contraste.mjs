// Controle de contraste de la palette du cockpit : node outils/contraste.mjs
//
// La feuille est sombre et monolithique, et le validateur de la trousse de
// visualisation ne s'applique pas ici, il juge des palettes categorielles de
// graphique. Le controle applicable est le contraste WCAG de chaque encre sur
// chacune des surfaces. C'est ce script qui fait foi avant toute retouche de
// couleur, et l'entete de public/style.css y renvoie.

import { readFile } from 'node:fs/promises';

const CSS = new URL('../public/style.css', import.meta.url);
const css = await readFile(CSS, 'utf8');

const jeton = (nom) => {
  const m = css.match(new RegExp(`--${nom}:\\s*(#[0-9A-Fa-f]{6})`));
  return m ? m[1] : null;
};

// Luminance relative WCAG 2.1
const lineaire = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * lineaire((n >> 16) & 255) + 0.7152 * lineaire((n >> 8) & 255) + 0.0722 * lineaire(n & 255);
};
const contraste = (a, b) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const SURFACES = ['fond', 'surface', 'surface-2', 'surface-3'];
const ENCRES = ['texte', 'texte-2', 'texte-3', 'accent', 'accent-texte', 'ok', 'attention', 'alerte'];
const SEUIL = 4.5; // texte courant ; 3 suffirait pour un element d'interface

const surfaces = SURFACES.map((n) => [n, jeton(n)]);
const absents = [...surfaces.filter(([, v]) => !v).map(([n]) => n), ...ENCRES.filter((n) => !jeton(n))];
if (absents.length) {
  console.error(`Jetons introuvables dans la feuille : ${absents.join(', ')}`);
  process.exit(1);
}

console.log(`Contraste WCAG, seuil ${SEUIL} pour du texte courant\n`);
console.log(`${'encre'.padEnd(14)}${surfaces.map(([n]) => n.padStart(12)).join('')}`);

const echecs = [];
for (const nom of ENCRES) {
  const hex = jeton(nom);
  const cases = surfaces.map(([sn, sh]) => {
    const r = contraste(hex, sh);
    if (r < SEUIL) echecs.push(`${nom} sur ${sn} : ${r.toFixed(2)}`);
    return r.toFixed(2).padStart(12);
  });
  console.log(`${nom.padEnd(14)}${cases.join('')}`);
}

const pire = Math.min(
  ...ENCRES.flatMap((n) => surfaces.map(([, sh]) => contraste(jeton(n), sh))),
);
console.log(`\nPire contraste : ${pire.toFixed(2)}`);
console.log(echecs.length ? `ECHECS :\n- ${echecs.join('\n- ')}` : 'Palette conforme, toutes les encres au-dessus du seuil.');
process.exit(echecs.length ? 1 : 0);
