// Harnais DOM minimal : execute public/app.js hors navigateur pour verifier que les
// toutes les vues rendent sans lever, y compris sur un dossier vide, et que
// les interactions ecrivent bien via PUT.
// PORT permet de viser une instance de test sans couper celle qui tourne.
const BASE = `http://127.0.0.1:${process.env.PORT ?? 4173}`;
const fetchReel = globalThis.fetch;

const noeuds = new Map();
const rendus = [];

function noeud(id) {
  if (!noeuds.has(id)) {
    noeuds.set(id, {
      id,
      dataset: {},
      hidden: true,
      textContent: '',
      // Le quiz des chiffres lit son champ par getElementById, le stub doit
      // donc pouvoir porter une valeur comme un vrai input.
      value: '',
      __html: '',
      __listeners: {},
      set innerHTML(v) { this.__html = v; if (this.id === 'view') rendus.push(v); },
      get innerHTML() { return this.__html; },
      addEventListener(type, fn) { (this.__listeners[type] ??= []).push(fn); },
      async declencher(type, evenement) {
        for (const fn of this.__listeners[type] ?? []) await fn(evenement);
      },
    });
  }
  return noeuds.get(id);
}

// Vestige du chat retire le 24/09 : app.js n'appelle plus querySelector que dans
// des chemins morts. Le stub reste parce qu'il ne coute rien et qu'il evite un
// plantage si une vue s'en ressert un jour.
const parSelecteur = new Map();
function stub(sel) {
  if (!parSelecteur.has(sel)) {
    parSelecteur.set(sel, {
      sel,
      value: '',
      textContent: '',
      disabled: false,
      hidden: false,
      dataset: {},
      classList: { add() {}, remove() {} },
      querySelector: () => stub(`${sel} >`),
      insertAdjacentHTML() {},
      remove() {},
      focus() {},
      scrollTo() {},
    });
  }
  return parSelecteur.get(sel);
}

globalThis.document = { getElementById: noeud, querySelector: stub };
globalThis.window = globalThis; // ni SpeechRecognition ni speechSynthesis ici
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
globalThis.fetch = (url, opts) => fetchReel(BASE + url, opts);

await import(new URL('../public/app.js', import.meta.url).href);
await new Promise((r) => setTimeout(r, 600));

const erreurs = [];
const vue = noeud('view');
const tabs = noeud('tabs');

function verifier(nom) {
  const html = vue.innerHTML;
  if (!html || html.length < 80) erreurs.push(`${nom} : rendu vide ou trop court`);
  if (html.includes('Chargement impossible')) erreurs.push(`${nom} : erreur de chargement`);
  if (html.includes('undefined')) erreurs.push(`${nom} : contient "undefined"`);
  if (html.includes('[object Object]')) erreurs.push(`${nom} : contient "[object Object]"`);
  if (html.includes('NaN')) erreurs.push(`${nom} : contient "NaN"`);
  console.log(`  ${nom.padEnd(14)} ${String(html.length).padStart(6)} caracteres`);
}

const faux = (dataset, remonte = {}) => ({
  target: {
    id: dataset.id ?? '',
    value: dataset.value ?? '',
    closest: (sel) => {
      const clef = sel.replace(/[[\]]/g, '').split('=')[0];
      if (clef === 'data-role' && dataset.role) {
        return { dataset, value: dataset.value ?? '', checked: dataset.checked ?? false, closest: (s) => remonte[s] ?? null };
      }
      if (clef === 'data-onglet' && dataset.onglet) return { dataset };
      return null;
    },
  },
});

console.log('Rendu des onglets :');
for (const onglet of ['tableau', 'actions', 'entrainement', 'competences', 'realisations', 'engagements', 'remuneration', 'offres', 'cible', 'notes', 'inbox']) {
  await tabs.declencher('click', faux({ onglet }));
  verifier(onglet);
}

console.log('\nModes internes :');
const MODES_A_TESTER = [
  ['actions', ['horizon', 'echeance']],
  ['entrainement', ['reflexes', 'chiffres', 'direct', 'seances']],
  ['notes', ['notes', 'discussions']],
];
for (const [onglet, modes] of MODES_A_TESTER) {
  await tabs.declencher('click', faux({ onglet }));
  for (const mode of modes) {
    await vue.declencher('click', faux({ role: 'mode', onglet, mode }));
    verifier(`${onglet}/${mode}`);
  }
}

// Le parcours des modes laisse chaque onglet sur son DERNIER mode. Sans cette
// remise, l'exercice a choix plus bas tournerait sur la vue des seances et
// echouerait sans que la faute soit dans le code teste. Un harnais qui ne remet
// pas ce qu'il a touche est pire qu'un harnais absent.
for (const [onglet, modes] of MODES_A_TESTER) {
  await vue.declencher('click', faux({ role: 'mode', onglet, mode: modes[0] }));
}

/* -- exercice a choix, la serie entiere ---------------------------------- */

// Les deux modes Ollama ont ete retires le 24/09/2026, instantane dans
// archive/chat-ollama-2026-09-24/. L'onglet ne rend plus que l'exercice, qui ne
// depend d'aucun service et ne peut donc rien inventer.
const exos = await (await fetch('/api/data/exercices')).json();
console.log(`\nReflexes, ${exos.situations.length} situations :`);

await tabs.declencher('click', faux({ onglet: 'entrainement' }));
if (!vue.innerHTML.includes('choix-liste')) erreurs.push('les reflexes ne rendent pas');
// Le direct par canal fichier rend bien sa zone de saisie, et SANS reintroduire
// l'ancien chat local : ce sont deux choses differentes, l'une interrogeait un
// modele installe sur la machine, l'autre ecrit dans un fichier que relit une
// personne. Le controle ci-dessous distingue les deux.
await vue.declencher('click', faux({ role: 'mode', onglet: 'entrainement', mode: 'direct' }));
if (!vue.innerHTML.includes('saisie-direct')) erreurs.push('le direct ne rend pas sa zone de saisie');
else if (/ollama|chat-saisie|chat-pied/i.test(vue.innerHTML)) erreurs.push('le direct reintroduit l ancien chat local');
else console.log('  direct : canal fichier rendu, aucun vestige du chat local');
await vue.declencher('click', faux({ role: 'mode', onglet: 'entrainement', mode: 'reflexes' }));

// bulle-manager est legitime, l'exercice s'en sert pour la replique du manager.
if (/ollama|chat-saisie|chat-pied/i.test(vue.innerHTML)) erreurs.push('du chat subsiste dans la vue');

// Etat de depart, pour restituer le fichier a la fin du passage.
const seriesAvant = (await (await fetch('/api/data/entrainement')).json()).series ?? [];

async function parcourir(choisirBon) {
  await vue.declencher('click', faux({ role: 'ent-recommencer' }));
  for (let n = 0; n < exos.situations.length; n++) {
    const s = exos.situations[n];
    const k = choisirBon
      ? s.options.findIndex((o) => o.bon)
      : s.options.findIndex((o) => !o.bon);
    await vue.declencher('click', faux({ role: 'ent-choix', k: String(k) }));
    const apres = vue.innerHTML;
    if (!apres.includes('choix-bon')) erreurs.push(`${s.id} : la bonne reponse n est pas signalee`);
    if (!apres.includes('choix-motif')) erreurs.push(`${s.id} : le motif ne s affiche pas`);
    await vue.declencher('click', faux({ role: 'ent-suivant' }));
  }
  return vue.innerHTML;
}

const bilanParfait = await parcourir(true);
if (!bilanParfait.includes('Sans faute')) erreurs.push('le sans-faute n est pas reconnu');
else console.log('  serie tout juste : bilan sans faute');

const bilanRate = await parcourir(false);
if (!bilanRate.includes('fois')) erreurs.push('le bilan ne recapitule pas les fautes');
else console.log('  serie tout faux : fautes recapitulees et classees');

// Les situations livrees avec le gabarit sont universelles : elles parlent de
// « ton montant » et jamais d'un nombre. Une bonne reponse qui cite un montant
// est donc soit une fuite de donnees personnelles, soit un chiffre invente.
//
// Les situations ajoutees par /demarrer a partir du dossier de l'adoptant sont
// exclues de ce controle : elles ont le droit de citer SES chiffres.
for (const s of exos.situations) {
  const bon = s.options.find((o) => o.bon);
  if (!s.id.startsWith('s')) continue; // les situations livrees sont s1..sN
  const montants = bon.texte.match(/\b\d{1,3}[\s\u00a0\u202f]\d{3}\b|\b\d{4,6}\s*(?:€|EUR\b)/g) ?? [];
  for (const m of montants) erreurs.push(`${s.id} : montant dans une bonne reponse livree, "${m}"`);
  if (s.options.filter((o) => o.bon).length !== 1) erreurs.push(`${s.id} : pas exactement une bonne reponse`);
}
console.log('  aucun montant dans les bonnes reponses livrees');

/* -- persistance des series ---------------------------------------------- */

// Les deux series ci-dessus ont ete jouees, elles doivent etre sur disque. Le
// bilan tire son interet de la comparaison d'une serie a l'autre, donc une serie
// qui ne s'ecrit pas vide la fonctionnalite de son sens.
await new Promise((r) => setTimeout(r, 600)); // les ecritures sont mises en file
const apresSeries = (await (await fetch('/api/data/entrainement')).json()).series ?? [];
const ajoutees = apresSeries.length - seriesAvant.length;
if (ajoutees !== 2) erreurs.push(`${ajoutees} serie(s) enregistree(s) au lieu de 2`);
else console.log(`  ${ajoutees} series enregistrees sur disque, ${apresSeries.length} au total`);

const derniere = apresSeries[0];
if (!derniere || derniere.justes !== 0) erreurs.push('la derniere serie devrait etre a zero juste');
else if (Object.keys(derniere.fautes ?? {}).length === 0) erreurs.push('les fautes de la serie ne sont pas enregistrees');
else console.log(`  derniere serie : ${derniere.justes}/${derniere.total}, ${Object.keys(derniere.fautes).length} fautes distinctes`);

// Avec deux series au moins, le bilan doit signaler ce qui revient.
if (apresSeries.length >= 2 && !bilanRate.includes("d'une série à l'autre")) {
  erreurs.push('le bilan ne compare pas les series entre elles');
} else if (apresSeries.length >= 2) {
  console.log('  le bilan compare les series et signale ce qui revient');
}

// Remise en etat.
await fetch('/api/data/entrainement', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...(await (await fetch('/api/data/entrainement')).json()), series: seriesAvant }),
});

/* -- interaction reelle -------------------------------------------------- */

// Cocher une action doit basculer son statut et le persister.
//
// CE TEST ECRIT DANS LES VRAIES DONNEES. Le 25/09 il a laisse l'action e1, le
// deroule de l'entretien, marquee faite alors que l'entretien n'avait pas eu
// lieu : un passage interrompu avait saute la remise en etat. D'ou le finally,
// et le controle que la restauration a bien abouti. Un harnais qui corrompt ce
// qu'il verifie est pire qu'un harnais absent.
await tabs.declencher('click', faux({ onglet: 'actions' }));
const avant = await (await fetch('/api/data/actions')).json();
const cible = avant.actions[0];

if (!cible) {
  console.log('\nBascule d action : aucune action au dossier, test ignore.');
  console.log(erreurs.length ? `\nECHECS :\n- ${erreurs.join('\n- ')}` : '\nTout est vert.');
  process.exit(erreurs.length ? 1 : 0);
}

const statutAvant = cible.statut;

try {
  await vue.declencher('click', faux(
    { role: 'toggle' },
    { '[data-action-id]': { dataset: { actionId: cible.id } } },
  ));
  const apres = await (await fetch('/api/data/actions')).json();
  console.log(`\nBascule action ${cible.id} : ${statutAvant} -> ${apres.actions[0].statut} (persiste sur disque)`);
  if (statutAvant === apres.actions[0].statut) erreurs.push('la bascule de statut n a pas ete persistee');
} finally {
  // La remise en etat part du fichier tel qu'il est A CET INSTANT, pas d'une
  // copie prise avant : entre-temps le test des series a pu ecrire ailleurs.
  const courant = await (await fetch('/api/data/actions')).json();
  courant.actions[0].statut = statutAvant;
  await fetch('/api/data/actions', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(courant),
  });

  const verifie = await (await fetch('/api/data/actions')).json();
  if (verifie.actions[0].statut !== statutAvant) {
    erreurs.push(`RESTAURATION ECHOUEE, ${cible.id} est reste a ${verifie.actions[0].statut} au lieu de ${statutAvant}`);
  } else {
    console.log(`  restauration verifiee, ${cible.id} est bien revenue a ${statutAvant}`);
  }
}

console.log(erreurs.length ? `\nECHECS :\n- ${erreurs.join('\n- ')}` : '\nTout est vert.');
process.exit(erreurs.length ? 1 : 0);
