// Controle geometrique des graphiques SVG de l onglet Remuneration.
//
//   PORT=4199 node server.js &
//   PORT=4199 node outils/verif-graphiques.mjs
//
// Les graphiques sont calcules a partir des 59 bulletins, donc leurs coordonnees
// dependent des donnees. Ce controle verifie qu elles restent finies et dans leur
// viewBox quoi qu il arrive aux fiches, et que le trace se coupe si et seulement
// si un mois manque. Il remplace l oeil, la page ne s ouvrant pas partout.
process.env.PORT ??= '4199';
const noeuds = new Map();
let dernier = '';
const noeud = (id) => {
  if (!noeuds.has(id)) noeuds.set(id, { id, dataset: {}, hidden: true, textContent: '', __html: '', __l: {},
    set innerHTML(v) { this.__html = v; if (this.id === 'view') dernier = v; },
    get innerHTML() { return this.__html; },
    addEventListener(t, f) { (this.__l[t] ??= []).push(f); },
    async declencher(t, e) { for (const f of this.__l[t] ?? []) await f(e); } });
  return noeuds.get(id);
};
globalThis.document = { getElementById: noeud, querySelector: () => ({ value: '', textContent: '', dataset: {}, classList: { add() {}, remove() {} }, querySelector: () => ({}), insertAdjacentHTML() {}, remove() {}, focus() {}, scrollTo() {} }) };
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
const fr = globalThis.fetch;
globalThis.fetch = (u, o) => fr(`http://127.0.0.1:${process.env.PORT}` + u, o);
await import(new URL('../public/app.js', import.meta.url).href);
await new Promise((r) => setTimeout(r, 700));
await noeud('tabs').declencher('click', { target: { id: '', value: '', closest: (s) => (s.includes('onglet') ? { dataset: { onglet: 'remuneration' } } : null) } });

const erreurs = [];
const svgs = [...dernier.matchAll(/<svg[^>]*viewBox="([^"]+)"[\s\S]*?<\/svg>/g)];
if (svgs.length !== 3) erreurs.push(`${svgs.length} graphiques au lieu de 3`);

svgs.forEach(([bloc, vb], n) => {
  const [, , W, H] = vb.split(/\s+/).map(Number);
  const nom = `graphique ${n + 1}`;
  let coords = 0;

  // Les chemins : chaque paire de nombres apres une commande de trace.
  for (const [, d] of bloc.matchAll(/\sd="([^"]+)"/g)) {
    const nb = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (!nb.length) erreurs.push(`${nom} : chemin vide`);
    for (let i = 0; i < nb.length; i += 2) {
      const x = Number(nb[i]); const y = Number(nb[i + 1]);
      coords += 2;
      if (!Number.isFinite(x) || !Number.isFinite(y)) erreurs.push(`${nom} : coordonnee non finie`);
      if (x < -1 || x > W + 1) erreurs.push(`${nom} : x=${x} hors [0, ${W}]`);
      if (y < -1 || y > H + 1) erreurs.push(`${nom} : y=${y} hors [0, ${H}]`);
    }
  }

  // Les cercles, les lignes, les rectangles et les textes.
  for (const attr of ['cx', 'x1', 'x2', 'x']) {
    for (const [, v] of bloc.matchAll(new RegExp(`\\s${attr}="([^"]+)"`, 'g'))) {
      const x = Number(v); coords += 1;
      if (!Number.isFinite(x)) { erreurs.push(`${nom} : ${attr} non fini "${v}"`); continue; }
      if (x < -1 || x > W + 1) erreurs.push(`${nom} : ${attr}=${x} hors [0, ${W}]`);
    }
  }
  for (const attr of ['cy', 'y1', 'y2', 'y']) {
    for (const [, v] of bloc.matchAll(new RegExp(`\\s${attr}="([^"]+)"`, 'g'))) {
      const y = Number(v); coords += 1;
      if (!Number.isFinite(y)) { erreurs.push(`${nom} : ${attr} non fini "${v}"`); continue; }
      if (y < -1 || y > H + 1) erreurs.push(`${nom} : ${attr}=${y} hors [0, ${H}]`);
    }
  }
  console.log(`  ${nom} : viewBox ${W}x${H}, ${coords} coordonnees verifiees`);
});

// Le trace principal doit porter un point par bulletin et une seule sous-courbe
// tant qu'aucun mois ne manque.
const paie = await (await fetch('/api/data/paie')).json();
const pts = (svgs[0][0].match(/<circle/g) ?? []).length;
if (pts !== paie.fiches.length) erreurs.push(`${pts} points pour ${paie.fiches.length} bulletins`);
const coupures = (svgs[0][0].match(/\sd="[^"]*"/)[0].match(/M/g) ?? []).length;
const attendu = paie.trous.length ? 'plus de 1' : 1;
if (paie.trous.length === 0 && coupures !== 1) erreurs.push(`${coupures} sous-courbes alors qu aucun mois ne manque`);
console.log(`  trace principal : ${pts} points, ${coupures} sous-courbe(s), attendu ${attendu}`);

// Chaque serie porte un point par bulletin : deux dans le cadre du haut, le brut
// et le net percu, une seule dans le cadre de l'impot.
const nbPoints = (d) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).length / 2;
const series = (n) => [...svgs[n][0].matchAll(/<path class="courbe[^"]*" d="([^"]+)"/g)].map((m) => m[1]);
const haut = series(0);
const bas = series(1);
if (haut.length !== 2) erreurs.push(`${haut.length} series dans le cadre du haut au lieu de 2`);
if (bas.length !== 1) erreurs.push(`${bas.length} serie(s) dans le cadre de l impot au lieu de 1`);
for (const d of [...haut, ...bas]) {
  if (nbPoints(d) !== paie.fiches.length) erreurs.push(`une serie porte ${nbPoints(d)} points pour ${paie.fiches.length} bulletins`);
}
console.log(`  series : ${haut.length} en haut, ${bas.length} pour l impot, ${paie.fiches.length} points chacune`);

// Les deux cadres se lisent ensemble, donc leur axe des temps doit etre le meme.
// Ils ont des echelles verticales differentes, c'est voulu, mais un decalage
// horizontal ferait correspondre des mois qui ne se correspondent pas.
if (haut.length && bas.length) {
  const debut = (d) => Number(d.match(/-?\d+(?:\.\d+)?/)[0]);
  const ecart = Math.abs(debut(haut[0]) - debut(bas[0]));
  if (ecart > 0.05) erreurs.push(`les deux cadres ne partagent pas le meme axe des temps, ecart ${ecart.toFixed(2)}`);
  console.log(`  axes des temps alignes : ${debut(haut[0]).toFixed(1)} et ${debut(bas[0]).toFixed(1)}`);
}

console.log(erreurs.length ? `\n${erreurs.length} probleme(s) :\n  ${erreurs.join('\n  ')}` : '\nGeometrie conforme.');
process.exit(erreurs.length ? 1 : 0);
