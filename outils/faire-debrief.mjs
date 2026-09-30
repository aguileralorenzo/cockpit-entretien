// Construit la page de debrief d'une repetition du skill /train.
//
//   node outils/faire-debrief.mjs <evaluation.json> [sortie.html]
//
// L'evaluation est produite par Claude a la fin d'une repetition. Cet outil ne
// juge rien : il met en page, il calcule la note ponderee et il place les barres
// du graphique. Toute la matiere, notes et prose, vient du JSON.
//
// LE BAREME EST ICI, PAS DANS LE JSON. Les poids ne se negocient pas d'une
// seance a l'autre, sinon la note de deux seances n'est plus comparable et elle
// ne veut plus rien dire. Une phase absente du JSON est retiree et les poids
// restants sont renormalises a 100, ce qui permet de debriefer une repetition
// interrompue sans fausser la note.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { argv } from 'node:process';

const RACINE = new URL('..', import.meta.url);

// Les sept phases de l'entretien, dans l'ordre ou elles arrivent. Le poids dit
// ce que la phase coute reellement. Un quart de la note se joue sur le moment ou
// le manager demande de baisser, parce que c'est la que l'argent change de main.
const BAREME = [
  { cle: 'ouverture', nom: 'Ouverture', poids: 10 },
  { cle: 'bilan', nom: 'Le bilan passé', poids: 10 },
  { cle: 'demande', nom: 'La demande', poids: 20 },
  { cle: 'mur', nom: 'Le mur', poids: 15 },
  { cle: 'montant', nom: 'Le montant sous pression', poids: 25 },
  { cle: 'calendrier', nom: 'Le calendrier', poids: 10 },
  { cle: 'sortie', nom: 'La sortie', poids: 10 },
];

// Les reperes viennent du dossier, jamais du code. C'est le seul endroit ou ils
// existent, et le controleur lit le meme fichier.
const nego = JSON.parse(await readFile(new URL('../data/negociation.json', import.meta.url), 'utf8'));
const M = nego.montants ?? {};

// Les parts de la decomposition, telles que le dossier les declare.
const PARTS = nego.decomposition?.parts ?? [];

const [, , entree, sortieArg] = argv;
if (!entree) throw new Error('usage : node outils/faire-debrief.mjs <evaluation.json> [sortie.html]');

const ev = JSON.parse(await readFile(entree, 'utf8'));

/* -- la note ----------------------------------------------------------------- */

const phases = BAREME
  .map((b) => ({ ...b, ...(ev.phases.find((p) => p.cle === b.cle) ?? {}) }))
  .filter((p) => typeof p.note === 'number');

if (!phases.length) throw new Error('aucune phase notee dans l evaluation');
for (const p of phases) {
  if (p.note < 0 || p.note > 20) throw new Error(`phase ${p.cle} : note ${p.note} hors de 0 a 20`);
  if (!p.mot) throw new Error(`phase ${p.cle} : il manque la ligne de verdict`);
}

// Renormalisation, pour qu'une seance interrompue reste notee sur la meme echelle.
const poidsBruts = phases.reduce((s, p) => s + p.poids, 0);
for (const p of phases) p.part = (p.poids / poidsBruts) * 100;
const note = phases.reduce((s, p) => s + (p.note * p.part) / 100, 0);
const partielle = phases.length < BAREME.length;

// Trois bandes, parce que deux mentent. Sous 10 c'est rate, de 10 a 14 c'est
// passable et ca ne se celebre pas, au-dessus de 14 c'est tenu.
const bande = note < 10 ? 'lache' : note < 14 ? 'moyen' : 'tenu';

const VIDE = 'a renseigner';
const fr = (n, d) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
  : VIDE);
const eur = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${fr(n, Number.isInteger(n) ? 0 : 2)} €` : VIDE);
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* -- le graphique ------------------------------------------------------------- */

// Hauteur, la note. Largeur, le poids. La barre la plus large est donc aussi
// celle qui pese le plus, et le regard va d'abord la ou ca coute.
//
// Chaque barre porte sa part EXACTE dans data-part. Le texte affiche la part
// arrondie a l'entier, qui se lit mieux mais ne suffit pas a recalculer la
// geometrie : sur une seance partielle les parts tombent sur 18,18 ou 36,36 et
// l'arrondi decale la largeur attendue de plusieurs pixels.
const W = 720, H = 262, L = 42, R = 14, T = 26, BAS = 230, GOUT = 3;
const gy = (v) => T + (1 - v / 20) * (BAS - T);
const largeurUtile = W - L - R - GOUT * (phases.length - 1);

let x = L;
for (const p of phases) {
  p.w = (largeurUtile * p.part) / 100;
  p.x = x;
  p.y = gy(p.note);
  p.h = BAS - p.y;
  p.milieu = x + p.w / 2;
  x += p.w + GOUT;
}

const grille = [0, 5, 15, 20]
  .map((v) => `<line class="grille" x1="${L}" x2="${W - R}" y1="${gy(v).toFixed(1)}" y2="${gy(v).toFixed(1)}"></line>`
    + `<text class="axe" x="${L - 8}" y="${(gy(v) + 4).toFixed(1)}">${v}</text>`)
  .join('\n          ');

const barres = phases
  .map((p, i) => `<rect class="barre${p.note < 10 ? ' sous' : ''}" data-part="${p.part.toFixed(3)}" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h.toFixed(1)}"></rect>
          <text class="val" x="${p.milieu.toFixed(1)}" y="${(p.y - 7).toFixed(1)}">${p.note}</text>
          <text class="rang" x="${p.milieu.toFixed(1)}" y="${BAS + 18}">${i + 1}</text>`)
  .join('\n          ');

/* -- les blocs ---------------------------------------------------------------- */

const listePhases = phases
  .map((p, i) => `      <div>
        <span class="rang">${i + 1}</span><span class="nom">${esc(p.nom)}</span><span class="score ${p.note < 10 ? 'sous' : 'sur'}">${p.note} · ${fr(p.part, 0)} %</span>
        <span class="mot">${esc(p.mot)}</span>
      </div>`)
  .join('\n');

const corrections = ev.corrections
  .map((c) => `      <div class="correction">
        <h3>${esc(c.titre)}</h3>
        <p>${esc(c.texte)}</p>
      </div>`)
  .join('\n');

const cartons = ev.phrases
  .map((c) => `      <div class="carton">
        <p class="quand">${esc(c.quand)}</p>
        <p class="dire">${esc(c.dire)}</p>
      </div>`)
  .join('\n');

const bloc = (liste, puce) => liste
  .map((e) => `      <div>
        <p class="titre"><span class="puce ${puce}">${esc(e.puce ?? puce)}</span> ${esc(e.titre)}</p>
        ${e.cite ? `<p class="cite">« ${esc(e.cite)} »</p>` : ''}
        <p class="quoi">${esc(e.quoi)}</p>
      </div>`)
  .join('\n');

const jetons = [
  M.demande != null ? `${eur(M.demande)} demandes` : null,
  M.actuel != null && M.demande != null ? `${eur(M.demande - M.actuel)} d'ecart` : null,
  ...PARTS.filter((p) => p.montant != null).map((p) => `${eur(p.montant)} ${p.libelle ?? ''}`.trim()),
  nego.engagement_non_tenu?.ecart_mensuel != null ? `${eur(nego.engagement_non_tenu.ecart_mensuel)} manquants` : null,
  M.plancher != null ? `${eur(M.plancher)} plancher` : null,
  M.plancher_absolu != null ? `${eur(M.plancher_absolu)} plancher absolu` : null,
]
  .filter(Boolean)
.map((j) => `<span class="jeton">${esc(j)}</span>`).join('\n      ');

/* -- le compteur du chiffre ---------------------------------------------------- */

const c = ev.chiffre;
const marge = M.demande - M.plancher;
const brulee = c.descendu ? M.demande - c.descendu : 0;

const compteur = [
  { quoi: 'Annoncé, un seul chiffre, sans fourchette', combien: eur(c.annonce), ton: c.annonce === M.demande && !c.fourchette ? 'bon' : 'mauvais' },
  c.descendu ? { quoi: 'Descendu de ton propre chef, sans contre-proposition', combien: eur(c.descendu), ton: 'mauvais' } : null,
  M.plancher != null ? { quoi: 'Ton plancher de repli', combien: eur(M.plancher), ton: '' } : null,
  M.plancher_absolu != null ? { quoi: c.sousPlancherAbsolu ? 'Ton plancher absolu, franchi' : 'Ton plancher absolu, jamais atteint', combien: eur(M.plancher_absolu), ton: c.sousPlancherAbsolu ? 'mauvais' : '' } : null,
  brulee ? { quoi: `Marge brûlée en un seul mouvement, sur ${eur(marge)} disponibles`, combien: eur(brulee), ton: 'mauvais' } : null,
]
  .filter(Boolean)
  .map((l) => `      <div class="${l.ton}">
        <span class="quoi">${esc(l.quoi)}</span>
        <span class="combien">${esc(l.combien)}</span>
      </div>`)
  .join('\n');

/* -- la page -------------------------------------------------------------------- */

const page = `<title>Avant l'entretien</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  :root {
    --fond: #F3F6F8;
    --surface: #FFFFFF;
    --carte: #141C23;
    --carte-encre: #EDF2F5;
    --encre: #121A21;
    --encre-2: #47545E;
    --encre-3: #78858F;
    --filet: #DAE1E7;
    --filet-fort: #BDC8D0;
    --accent: #1B4FA0;
    --accent-doux: #E5EDF8;
    --tenu: #0B6247;
    --tenu-doux: #E2F0EA;
    --lache: #9E3225;
    --lache-doux: #F8E8E5;
    --moyen: #8A5410;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --fond: #0E1419;
      --surface: #161E25;
      --carte: #05090C;
      --carte-encre: #EDF2F5;
      --encre: #DCE4EA;
      --encre-2: #A2AEB8;
      --encre-3: #7A8791;
      --filet: #253038;
      --filet-fort: #37454F;
      --accent: #6FA3F0;
      --accent-doux: #14243C;
      --tenu: #58C79E;
      --tenu-doux: #10291F;
      --lache: #E8837A;
      --lache-doux: #2C1815;
      --moyen: #D7A24C;
    }
  }
  :root[data-theme="dark"] {
    --fond: #0E1419;
    --surface: #161E25;
    --carte: #05090C;
    --carte-encre: #EDF2F5;
    --encre: #DCE4EA;
    --encre-2: #A2AEB8;
    --encre-3: #7A8791;
    --filet: #253038;
    --filet-fort: #37454F;
    --accent: #6FA3F0;
    --accent-doux: #14243C;
    --tenu: #58C79E;
    --tenu-doux: #10291F;
    --lache: #E8837A;
    --lache-doux: #2C1815;
    --moyen: #D7A24C;
  }

  body {
    background: var(--fond);
    color: var(--encre);
    font-family: "Source Sans 3", ui-sans-serif, system-ui, sans-serif;
    font-size: 17px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 700px;
    margin: 0 auto;
    padding-inline: 20px;
    padding-block: 44px 90px;
    display: flex;
    flex-direction: column;
    gap: 44px;
  }
  p { margin: 0; }
  h1, h2, h3 { margin: 0; font-family: "Zilla Slab", Georgia, serif; text-wrap: balance; }
  h1 { font-size: clamp(32px, 7vw, 44px); font-weight: 600; line-height: 1.08; letter-spacing: -0.015em; }
  h2 { font-size: clamp(21px, 4.2vw, 26px); font-weight: 600; line-height: 1.22; }
  h3 { font-size: 17px; font-weight: 600; }
  strong { font-weight: 600; }

  .chapeau { color: var(--encre-2); font-size: 18px; }
  .menu { color: var(--encre-3); font-size: 14.5px; }
  .oeil {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--encre-3);
  }

  section { display: flex; flex-direction: column; gap: 18px; }
  section > header { display: flex; flex-direction: column; gap: 7px; }
  hr { border: 0; border-top: 1px solid var(--filet); margin: 0; }

  .verdict {
    padding: 24px;
    background: var(--surface);
    border: 1px solid var(--filet);
    border-left: 4px solid var(--accent);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .verdict .gros { font-family: "Zilla Slab", Georgia, serif; font-size: clamp(22px, 4.6vw, 28px); font-weight: 600; line-height: 1.25; }

  .note {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 20px;
    padding: 24px;
    background: var(--surface);
    border: 1px solid var(--filet);
    border-left: 4px solid var(--${bande});
  }
  .note .chiffre {
    font-family: "Zilla Slab", Georgia, serif;
    font-size: clamp(48px, 12vw, 68px);
    font-weight: 600;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--${bande});
  }
  .note .sur { font-family: "Zilla Slab", Georgia, serif; font-size: 24px; font-weight: 500; color: var(--encre-3); }
  .note .lecture { flex: 1 1 260px; color: var(--encre-2); font-size: 16px; }

  .cadre { overflow-x: auto; background: var(--surface); border: 1px solid var(--filet); padding: 12px 8px 6px; }
  svg.perf { display: block; width: 100%; min-width: 520px; height: auto; }
  .perf .grille { stroke: var(--filet); stroke-width: 1; }
  .perf .moyenne { stroke: var(--encre-3); stroke-width: 1.5; stroke-dasharray: 5 4; }
  .perf .barre { fill: var(--tenu); }
  .perf .barre.sous { fill: var(--lache); }
  .perf .val { fill: var(--encre); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; font-weight: 500; text-anchor: middle; }
  .perf .rang { fill: var(--encre-3); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; text-anchor: middle; }
  .perf .axe { fill: var(--encre-3); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; text-anchor: end; }
  .perf .repere { fill: var(--encre-3); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; }

  .phases { display: grid; gap: 1px; background: var(--filet); border: 1px solid var(--filet); }
  .phases > div { background: var(--surface); padding: 13px 16px; display: grid; grid-template-columns: auto 1fr auto; gap: 3px 13px; align-items: baseline; }
  .phases .rang { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; color: var(--encre-3); }
  .phases .nom { font-weight: 600; font-size: 15.5px; }
  .phases .score { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; font-weight: 500; font-size: 15px; }
  .phases .score.sous { color: var(--lache); }
  .phases .score.sur { color: var(--tenu); }
  .phases .mot { grid-column: 2 / -1; color: var(--encre-2); font-size: 15px; }

  .corrections { display: flex; flex-direction: column; gap: 16px; counter-reset: c; }
  .correction {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    padding: 20px 22px;
    background: var(--surface);
    border: 1px solid var(--filet);
  }
  .correction::before {
    counter-increment: c;
    content: counter(c);
    grid-row: 1 / span 2;
    font-family: "Zilla Slab", Georgia, serif;
    font-size: 30px;
    font-weight: 600;
    line-height: 1;
    color: var(--accent);
  }
  .correction h3 { align-self: center; }
  .correction p { color: var(--encre-2); font-size: 16px; }

  .cartons { display: flex; flex-direction: column; gap: 14px; }
  .carton {
    padding: 22px 24px;
    background: var(--carte);
    color: var(--carte-encre);
    border-radius: 3px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .carton .quand {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #8FA3B4;
  }
  .carton .dire {
    font-family: "Zilla Slab", Georgia, serif;
    font-size: clamp(18px, 3.6vw, 21px);
    font-weight: 500;
    line-height: 1.42;
  }

  .bilan { display: flex; flex-direction: column; gap: 1px; background: var(--filet); border: 1px solid var(--filet); }
  .bilan > div { background: var(--surface); padding: 15px 18px; display: flex; flex-direction: column; gap: 5px; }
  .bilan .cite { font-style: italic; color: var(--encre-2); font-size: 15.5px; }
  .bilan .quoi { font-size: 15.5px; color: var(--encre-2); }
  .bilan .titre { font-weight: 600; font-size: 15.5px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 9px; }
  .puce {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 2px;
  }
  .puce.tenu { color: var(--tenu); background: var(--tenu-doux); }
  .puce.lache { color: var(--lache); background: var(--lache-doux); }

  .chiffres {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 18px 20px;
    background: var(--accent-doux);
    border: 1px solid var(--accent);
  }
  .chiffres .jeton {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 14px;
    font-weight: 500;
    padding: 5px 10px;
    background: var(--surface);
    border: 1px solid var(--filet-fort);
    border-radius: 2px;
    white-space: nowrap;
  }

  .compteur { display: grid; gap: 1px; background: var(--filet); border: 1px solid var(--filet); }
  .compteur > div { background: var(--surface); padding: 14px 18px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 14px; }
  .compteur .quoi { color: var(--encre-2); font-size: 15px; }
  .compteur .combien { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; font-weight: 500; }
  .compteur .mauvais .combien { color: var(--lache); }
  .compteur .bon .combien { color: var(--tenu); }

  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="page">

  <header>
    <p class="oeil">Répétition du ${esc(ev.dateLisible)}, difficulté ${esc(ev.difficulte)}</p>
    <h1 style="margin-top:10px">Avant l'entretien</h1>
    <p class="chapeau" style="margin-top:14px">${esc(ev.chapeau)}</p>
  </header>

  <div class="verdict">
    <p class="oeil">Ce que tu serais sorti avec</p>
    <p class="gros">${esc(ev.verdict.ecrit)}</p>
    <p class="menu">${esc(ev.verdict.detail)}</p>
  </div>

  <hr>

  <section>
    <header>
      <p class="oeil">La note</p>
      <h2>Performance par phase</h2>
    </header>

    <div class="note">
      <span class="chiffre">${fr(note, 1)}</span><span class="sur">/ 20</span>
      <p class="lecture">${esc(ev.lectureNote)}</p>
    </div>

    <figure style="margin:0;display:flex;flex-direction:column;gap:12px">
      <div class="cadre">
        <svg class="perf" viewBox="0 0 ${W} ${H}" role="img"
             aria-label="Note sur 20 pour chaque phase de l'entretien. ${esc(phases.map((p) => `${p.nom} ${p.note}`).join(', '))}. La largeur de chaque barre est son poids dans la note.">
          ${grille}
          ${barres}
          <line class="moyenne" x1="${L}" x2="${W - R}" y1="${gy(10).toFixed(1)}" y2="${gy(10).toFixed(1)}"></line>
          <text class="repere" x="${L + 4}" y="${(gy(10) - 5).toFixed(1)}">la moyenne, 10</text>
        </svg>
      </div>
      <figcaption class="menu">
        La hauteur est la note, <strong>la largeur est le poids de la phase dans la note finale</strong>.
        ${phases.some((p) => p.note < 10)
          ? 'Regarde d\'abord les barres larges et basses, c\'est là que la séance s\'est jouée.'
          : 'Aucune phase sous la moyenne.'}
      </figcaption>
    </figure>

    <div class="phases">
${listePhases}
    </div>

    <p class="menu">
      Le calcul, à refaire si tu veux le contester.
      ${phases.map((p) => `${p.note}×${fr(p.part / 100, 2)}`).join(' plus ')}, soit ${fr(note, 1)}.
      Les poids ne sont pas égaux parce que les phases ne valent pas la même chose.
      ${partielle
        ? `Cette séance n'a couvert que ${phases.length} phases sur ${BAREME.length}, les poids ont été ramenés à 100 pour que la note reste comparable aux autres.`
        : ''}
    </p>
  </section>

  <hr>

  <section>
    <header>
      <p class="oeil">Le chiffre</p>
      <h2>${esc(ev.titreChiffre)}</h2>
    </header>
    <div class="compteur">
${compteur}
    </div>
    <p class="menu">${esc(ev.motChiffre)}</p>
  </section>

  <hr>

  <section>
    <header>
      <p class="oeil">Classées par ce qu'elles coûtent</p>
      <h2>Les ${ev.corrections.length === 3 ? 'trois' : ev.corrections.length} choses à corriger</h2>
    </header>
    <div class="corrections">
${corrections}
    </div>
  </section>

  <hr>

  <section>
    <header>
      <p class="oeil">À dire mot pour mot</p>
      <h2>Les phrases</h2>
    </header>
    <div class="cartons">
${cartons}
    </div>
    ${ev.motPhrases ? `<p class="menu">${esc(ev.motPhrases)}</p>` : ''}
  </section>

  <hr>

  <section>
    <header>
      <p class="oeil">Référence</p>
      <h2>Tes seuls chiffres</h2>
    </header>
    <div class="chiffres">
      ${jetons}
    </div>
    <p class="menu">
      Rien d'autre ne sort de ta bouche. Le package et la note de frais ne sont jamais mentionnés,
      ils autorisent la réponse sur le package global.
    </p>
  </section>

  <hr>

  <section>
    <header>
      <p class="oeil">Le détail</p>
      <h2>Ce qui a tenu</h2>
    </header>
    <div class="bilan">
${bloc(ev.tenu, 'tenu')}
    </div>
  </section>

  <section>
    <header>
      <h2>Ce qui a lâché</h2>
    </header>
    <div class="bilan">
${bloc(ev.lache, 'lache')}
    </div>
  </section>

</div>
`;

const sortie = sortieArg ?? `export/debrief-${ev.date}.html`;
await mkdir(new URL('export/', RACINE), { recursive: true });
await writeFile(new URL(sortie, RACINE), page, 'utf8');

console.log(`${sortie} ecrit, ${(Buffer.byteLength(page, 'utf8') / 1024).toFixed(1)} ko`);
console.log(`note ${fr(note, 1)} / 20 sur ${phases.length} phase(s)${partielle ? ', poids renormalises' : ''}`);
console.log(phases.map((p) => `  ${p.nom.padEnd(26)} ${String(p.note).padStart(2)} · ${fr(p.part, 0).padStart(3)} %`).join('\n'));
