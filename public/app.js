// Cockpit de carriere, rendu cote client, sans framework.
// Les donnees vivent dans data/*.json, le serveur les sert et cette page les edite.
// Toute modification est ecrite immediatement sur disque, pour que le fichier
// reste la source de verite partagee entre l'interface et l'editeur de texte.

// Les libelles qui dependent de l'utilisateur. Ils ne sont jamais ecrits dans
// le code : l'outil RH et la convention viennent de la configuration, le nom du
// manager vient du dossier. Chacun a un repli lisible tant que rien n'est saisi.
const dit = {
  outilRh: () => state.config?.libelles?.outil_rh ?? "l'outil RH",
  convention: () => state.profil?.convention_collective ?? 'la convention collective',
  manager: () => state.profil?.manager?.actuel ?? 'ton manager',
};

const state = {
  config: null,
  profil: null,
  cible: null,
  actions: null,
  competences: null,
  realisations: null,
  engagements: null,
  offres: null,
  formulaire: null,
  discussions: null,
  paie: null,
  entrainement: null,
  exercices: null,
  inbox: { enAttente: [], traites: [] },
  notes: [],
  noteContenu: {}, // nom de fichier vers markdown brut, charge a la demande
};

const ui = {
  onglet: 'reste', // jusqu'au 29/09, remettre 'tableau' ensuite
  filtreStatut: 'ouvertes',
  cibleAffichee: null, // renseigne apres chargement depuis cible.cible_active
  exportVisible: false,
  noteActive: null,
  // Chaque rendu reconstruit le HTML. Sans ca, un pas a pas deplie se refermerait
  // des qu'on coche une action.
  etapesOuvertes: new Set(),
  discussionsOuvertes: new Set(),
  offresOuvertes: new Set(),
  baseComparaison: 'brut',
  // Session d'entrainement en cours. Volontairement hors de state, elle ne
  // s'ecrit sur disque qu'au debrief, pas a chaque replique.
  entrainement: {
    exercice: { i: 0, ordre: null, choisi: null, reponses: [], enregistree: false },
  },
};

const ONGLETS = [
  { id: 'reste', libelle: 'Reste à faire', groupe: 'Piloter' },
  { id: 'tableau', libelle: 'Tableau de bord', groupe: 'Piloter' },
  { id: 'actions', libelle: "Plan d'action", groupe: 'Piloter' },
  { id: 'entrainement', libelle: 'Entraînement', groupe: 'Piloter' },
  { id: 'competences', libelle: 'Compétences', groupe: 'Mon dossier' },
  { id: 'realisations', libelle: 'Réalisations', groupe: 'Mon dossier' },
  { id: 'engagements', libelle: 'Engagements', groupe: 'Mon dossier' },
  { id: 'remuneration', libelle: 'Rémunération', groupe: 'Mon dossier' },
  { id: 'offres', libelle: 'Marché', groupe: 'Se situer' },
  { id: 'cible', libelle: 'Cible et jalons', groupe: 'Se situer' },
  { id: 'notes', libelle: 'Notes', groupe: 'Ressources' },
  { id: 'discussions', libelle: 'Discussions', groupe: 'Ressources' },
  { id: 'inbox', libelle: 'Inbox', groupe: 'Ressources' },
];

const STATUTS = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  fait: 'Fait',
  abandonne: 'Abandonné',
};

const HORIZONS = { semaine: 'Cette semaine', mois: 'Ce mois-ci', trimestre: 'Ce trimestre' };

/* ---------------------------------------------------------------- outils */

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function toast(message, kind = 'info') {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { node.hidden = true; }, kind === 'error' ? 6000 : 2200);
}

async function charger(nom) {
  const reponse = await fetch(`/api/data/${nom}`);
  if (!reponse.ok) throw new Error(`lecture de ${nom} impossible (${reponse.status})`);
  return reponse.json();
}

// Ecrit le jeu de donnees sur disque. En cas d'echec on previent franchement,
// une modification silencieusement perdue serait pire que pas de modification.
//
// Les ecritures d'un meme jeu de donnees sont mises a la queue leu leu. Sans
// cela, deux sauvegardes rapprochees partent en parallele et c'est la DERNIERE
// ARRIVEE qui gagne, pas la derniere emise : constate le 24/09/2026 en enchainant
// deux series d'exercice, la seconde serie disparaissait du fichier.
const filesDEcriture = new Map();

async function sauver(nom) {
  const suite = (filesDEcriture.get(nom) ?? Promise.resolve()).then(async () => {
    try {
      const reponse = await fetch(`/api/data/${nom}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state[nom]),
      });
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      toast('Enregistré');
    } catch (err) {
      toast(`Échec de l'enregistrement : ${err.message}`, 'error');
    }
  });
  filesDEcriture.set(nom, suite);
  return suite;
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

// Lundi de la semaine contenant `date`, au format AAAA-MM-JJ. Sert de cle de semaine
// pour les habitudes, une seule case a cocher par semaine calendaire.
function lundiDe(date) {
  const d = new Date(date);
  const jour = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - jour);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dernieresSemaines(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(d);
    s.setDate(d.getDate() - i * 7);
    out.push(lundiDe(s));
  }
  return out;
}

const VIDE = '—';

const dateCourte = (iso) => {
  if (!iso) return VIDE;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const poids = (o) => (o == null ? 0 : o);
const renseigne = (v) => v !== null && v !== undefined && v !== '' && v !== 'a remplir';

const euros = (n) => (n == null ? VIDE : `${n.toLocaleString('fr-FR')} €`);

function taille(octets) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

/* -------------------------------------------------------------- markdown */

// Rendu markdown minimal, juste ce que les notes du projet utilisent.
// Le texte est echappe AVANT toute mise en forme, donc rien de ce qui vient
// du fichier ne peut produire de HTML.
function markdown(source) {
  const lignes = esc(source).split('\n');
  const html = [];
  let i = 0;

  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const cellules = (ligne) =>
    ligne.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

  const estSeparateur = (ligne) => /^\s*\|[\s:|-]+\|?\s*$/.test(ligne ?? '');

  while (i < lignes.length) {
    const ligne = lignes[i];

    if (!ligne.trim()) { i++; continue; }

    if (/^---+\s*$/.test(ligne)) { html.push('<hr>'); i++; continue; }

    const titre = ligne.match(/^(#{1,6})\s+(.*)$/);
    if (titre) {
      const n = titre[1].length;
      html.push(`<h${n}>${inline(titre[2])}</h${n}>`);
      i++;
      continue;
    }

    // Tableau, reconnu a sa ligne de separation
    if (ligne.trim().startsWith('|') && estSeparateur(lignes[i + 1])) {
      const entetes = cellules(ligne);
      i += 2;
      const corps = [];
      while (i < lignes.length && lignes[i].trim().startsWith('|')) {
        corps.push(cellules(lignes[i]));
        i++;
      }
      html.push(
        `<table><thead><tr>${entetes.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${corps.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      continue;
    }

    if (/^&gt;\s?/.test(ligne)) {
      const bloc = [];
      while (i < lignes.length && /^&gt;\s?/.test(lignes[i])) {
        bloc.push(lignes[i].replace(/^&gt;\s?/, ''));
        i++;
      }
      // Chaque citation est un bloc a coller dans l'outil RH, on lui donne son bouton.
      const brut = bloc.join('\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      html.push(
        `<div class="bloc-copiable">
           <button class="btn copier-bloc" data-role="copier-bloc">Copier</button>
           <blockquote>${markdown(brut)}</blockquote>
         </div>`,
      );
      continue;
    }

    const puce = /^\s*[-*]\s+/;
    const numero = /^\s*\d+\.\s+/;
    for (const [motif, balise] of [[puce, 'ul'], [numero, 'ol']]) {
      if (motif.test(ligne)) {
        const items = [];
        while (i < lignes.length && motif.test(lignes[i])) {
          // Le marqueur est ecrit DANS le li, et la puce native est coupee par la
          // feuille. Raison : le bouton Copier s'appuie sur innerText, qui ignore
          // les marqueurs generes par le navigateur. Sans cela, les quatre points
          // numerotes du commentaire general se collaient dans l'outil RH sans
          // leurs numeros, et les listes a tirets sans leurs tirets. Beaucoup de
          // formulaires RH n'interpretent
          // pas le markdown, confirme le 25/09/2026, donc ce qui est copie est
          // exactement ce qui sera lu.
          // Le numero vient de la source et n'est pas recompte : les points du
          // commentaire general sont separes par des lignes vides, donc chacun
          // forme sa propre liste, et un compteur les aurait tous numerotes 1.
          const marque = balise === 'ol' ? `${lignes[i].match(/\d+/)[0]}. ` : '- ';
          items.push(`<li><span class="marque">${marque}</span>${inline(lignes[i].replace(motif, ''))}</li>`);
          i++;
        }
        html.push(`<${balise} class="marquee">${items.join('')}</${balise}>`);
        break;
      }
    }
    if (puce.test(ligne) || numero.test(ligne)) continue;

    const para = [];
    while (i < lignes.length && lignes[i].trim() && !/^(#{1,6}\s|---+\s*$|&gt;|\s*[-*]\s|\s*\d+\.\s)/.test(lignes[i]) && !lignes[i].trim().startsWith('|')) {
      para.push(lignes[i]);
      i++;
    }
    if (para.length) html.push(`<p>${inline(para.join('<br>'))}</p>`);
    else i++;
  }

  return html.join('\n');
}

/* ------------------------------------------------------------- selecteurs */

const actionsOuvertes = () =>
  state.actions.actions.filter((a) => a.statut === 'a_faire' || a.statut === 'en_cours');

function ecarts(cible = ui.cibleAffichee) {
  const clef = cible === 'management' ? 'niveau_requis_management' : 'niveau_requis_seniorite';
  return state.competences.competences.map((c) => ({
    ...c,
    requis: c[clef],
    // Non evalue, on ne prend pas 0 par defaut, ce serait un faux ecart.
    ecart: c.niveau_actuel == null || c[clef] == null ? null : c[clef] - c.niveau_actuel,
  }));
}

const ecartsCritiques = () =>
  ecarts()
    .filter((c) => c.ecart != null && c.ecart > 0)
    .sort((a, b) => b.ecart - a.ecart);

const realisationsDuMois = () => {
  const mois = aujourdhui().slice(0, 7);
  return state.realisations.realisations.filter((r) => (r.date || '').startsWith(mois));
};

/* ------------------------------------------------------------------ vues */

function vueTableau() {
  const ouvertes = actionsOuvertes();
  const prioritaires = ouvertes.filter((a) => a.priorite === 1);
  const critiques = ecartsCritiques().slice(0, 3);
  const mois = realisationsDuMois();
  const t = state.cible.trajectoires[ui.cibleAffichee];

  // Le formulaire se partage deux jours ouvres avant l'entretien, ni plus ni moins.
  const pf = state.formulaire?.partage;
  const restants = (state.formulaire?.champs ?? []).filter((c) => !c.fait).length;
  const partage = pf
    ? `${dateCourte(pf.date_recommandee)} ${esc(pf.moment)}${
        pf.fait ? ', <span class="ecart ok">partagé</span>' : restants ? `, <span class="ecart gap">${restants} champ(s) à reprendre avant</span>` : ', <span class="ecart ok">prêt à partir</span>'
      }`
    : '<span class="faint">à définir</span>';

  const prochaineEcheance = ouvertes
    .filter((a) => a.echeance)
    .sort((a, b) => a.echeance.localeCompare(b.echeance))[0];



  return `
    <div class="grid cols-3">
      <div class="card stat">
        <span class="label">Actions prioritaires</span>
        <span class="value">${prioritaires.length}</span>
        <span class="note">${ouvertes.length} action(s) ouverte(s) au total</span>
      </div>
      <div class="card stat">
        <span class="label">Réalisations ce mois</span>
        <span class="value">${mois.length}</span>
        <span class="note">${state.realisations.realisations.length} consignée(s) depuis le début</span>
      </div>
      <div class="card stat">
        <span class="label">Fichiers en attente</span>
        <span class="value">${state.inbox.enAttente.length}</span>
        <span class="note">${state.inbox.traites.length} déjà traité(s)</span>
      </div>
    </div>

    <div class="card">
      <header>
        <h2>À faire en priorité</h2>
        ${prochaineEcheance
          ? `<span class="hint">prochaine échéance ${dateCourte(prochaineEcheance.echeance)}</span>`
          : '<span class="hint faint">aucune date posée</span>'}
      </header>
      ${prioritaires.length
        ? [...prioritaires]
            .sort((x, y) => (x.echeance ?? '9999').localeCompare(y.echeance ?? '9999'))
            .slice(0, 5)
            .map(ligneAction)
            .join('')
        : '<p class="empty">Aucune action prioritaire ouverte.</p>'}
    </div>

    <div class="card">
      <header>
        <h2>Profil</h2>
        <span class="hint">${esc(state.profil.localisation ?? '')}</span>
      </header>
      <dl class="kv">
        <dt>Intitulé contractuel</dt><dd>${esc(state.profil.intitule_contractuel ?? VIDE)}</dd>
        <dt>Rôle réellement tenu</dt><dd><strong>${esc(state.profil.role_reel_tenu ?? VIDE)}</strong></dd>
        <dt>Classification</dt><dd>${classificationHtml()}</dd>
        <dt>Ancienneté</dt><dd>${esc(state.profil.anciennete_entreprise_annees ?? '?')} ans chez ${esc(state.profil.employeur ?? '')}</dd>
        <dt>Mission</dt><dd>${esc(state.profil.mission_en_cours?.client ?? VIDE)}, ${esc(state.profil.mission_en_cours?.structure ?? '')}</dd>
        <dt>Rémunération</dt><dd>${remunerationHtml()}</dd>
      </dl>
    </div>

    <div class="card">
      <header>
        <h2>Cible active, ${esc(t?.libelle ?? ui.cibleAffichee)}</h2>
        <span class="hint">horizon ${esc(t?.horizon_mois ?? '?')} mois</span>
      </header>
      <dl class="kv">
        <dt>Poste visé</dt><dd>${renseigne(t?.intitule_vise) ? esc(t.intitule_vise) : '<span class="faint">à trancher</span>'}</dd>
        <dt>Rémunération visée</dt><dd>${formatRemuneration(t?.remuneration_visee)}</dd>
        <dt>Formulaire à partager</dt>
        <dd>${partage}</dd>
        <dt>Prochain entretien annuel</dt>
        <dd>${renseigne(state.profil.prochain_entretien_annuel) ? dateCourte(state.profil.prochain_entretien_annuel) : '<span class="faint">à renseigner</span>'}</dd>
        <dt>Fiche à remettre</dt>
        <dd>
          <a href="/fiche" target="_blank" rel="noopener noreferrer">ouvrir la fiche d'entretien</a>
          <span class="faint"> — à imprimer en deux exemplaires la veille</span>
        </dd>
      </dl>
    </div>

    <div class="card">
      <header><h2>Écarts les plus critiques</h2><span class="hint">cible ${esc(ui.cibleAffichee)}</span></header>
      ${critiques.length
        ? critiques.map(ligneCompetence).join('')
        : '<p class="empty">Aucun écart mesurable pour l\'instant.</p>'}
    </div>`;
}

// La classification conventionnelle est le fait le plus structurant du dossier,
// on l'affiche
// avec l'ecart au plancher de la position superieure, pas juste le libelle.
function classificationHtml() {
  const c = state.profil.classification;
  if (!c) return VIDE;
  const cible = (state.cible.references_marche?.grille_conventionnelle?.points ?? []).find(
    (p) => p.position !== c.position,
  );
  const brut = state.profil.remuneration?.brut_mensuel_base;
  let alerte = '';
  if (cible && brut != null && brut < cible.minimum_mensuel) {
    alerte = ` <span class="prio prio-1">sous le plancher ${esc(cible.position)} de ${Math.round(cible.minimum_mensuel - brut)} €</span>`;
  }
  return `Position ${esc(c.position)}, coefficient ${esc(c.coefficient)}${alerte}`;
}

function remunerationHtml() {
  const r = state.profil.remuneration;
  if (!r || r.brut_annuel_total == null) return '<span class="faint">à renseigner</span>';
  const variation = r.historique?.at(-1)?.variation_vs_precedent_pct;

  // La note de frais est versee hors bulletin, elle n'apparait nulle part ailleurs.
  // C'est pourtant elle qui fixe le seuil en dessous duquel une offre externe fait perdre.
  const p = r.package;
  const paquet = p
    ? `<div class="hint" style="margin-top:6px" title="${esc(p.equivalence?.methode ?? '')}">
         package <strong>${euros(p.totaux.package_en_equivalent_brut)}</strong> en équivalent brut,
         dont ${euros(p.note_de_frais.total_annuel_net)} de note de frais nette
         <br>une offre externe sans note de frais doit atteindre <strong>${euros(p.seuil_offre_externe.montant)}</strong> pour égaler
       </div>`
    : '';

  return `${euros(r.brut_annuel_total)} / an <span class="faint">(${euros(r.brut_mensuel_base)}/mois plus prime de vacances)</span>
          <div class="hint" style="margin-top:2px">dernière revalorisation ${dateCourte(r.date_derniere_revalorisation)}${
            variation != null ? `, <strong>+${variation} %</strong>` : ''
          }</div>${paquet}`;
}

function formatRemuneration(r) {
  if (!r || r.min == null) {
    return `<span class="faint">non sourcée${r?.source ? ` (${esc(String(r.source).slice(0, 60))})` : ''}</span>`;
  }
  const fourchette = r.max != null ? `${euros(r.min)} à ${euros(r.max)}` : euros(r.min);
  return `${fourchette} <span class="faint">par an</span>`;
}

function ligneAction(a) {
  const fait = a.statut === 'fait';
  const classe = fait ? 'action done' : a.statut === 'abandonne' ? 'action abandonne' : 'action';
  return `
    <div class="${classe}" data-action-id="${esc(a.id)}">
      <button class="tick" data-on="${fait}" data-role="toggle" title="Marquer fait ou à faire" aria-label="Marquer fait">✓</button>
      <div class="body">
        <div class="titre">${esc(a.titre)}</div>
        <div class="meta">
          ${a.priorite === 1 ? '<span class="prio prio-1">Prioritaire</span>, ' : ''}
          ${a.echeance ? `échéance ${dateCourte(a.echeance)}` : esc(HORIZONS[a.horizon] ?? '')}
          ${a.lie_a ? `, ${esc(a.lie_a)}` : ''}
        </div>
        ${a.note ? `<div class="note">${esc(a.note)}</div>` : ''}
        ${(a.etapes ?? []).length
          ? `<details class="etapes"${ui.etapesOuvertes.has(a.id) ? ' open' : ''} data-role="etapes" data-id="${esc(a.id)}">
               <summary>Pas à pas, ${a.etapes.length} étapes</summary>
               <ol>${a.etapes.map((e) => `<li>${esc(e)}</li>`).join('')}</ol>
             </details>`
          : ''}
      </div>
      <select data-role="statut" aria-label="Statut" style="width:auto;flex:none">
        ${Object.entries(STATUTS)
          .map(([v, l]) => `<option value="${v}"${v === a.statut ? ' selected' : ''}>${l}</option>`)
          .join('')}
      </select>
    </div>`;
}

function vueActions() {
  const filtres = { toutes: 'Toutes', ouvertes: 'Ouvertes', fait: 'Faites' };
  const visibles = state.actions.actions.filter((a) => {
    if (ui.filtreStatut === 'toutes') return true;
    if (ui.filtreStatut === 'fait') return a.statut === 'fait';
    return a.statut === 'a_faire' || a.statut === 'en_cours';
  });

  const parHorizon = Object.keys(HORIZONS)
    .map((h) => {
      const lot = visibles
        .filter((a) => a.horizon === h)
        .sort((a, b) => poids(a.priorite) - poids(b.priorite)
          || (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999'));
      if (!lot.length) return '';
      return `<div class="card">
                <header><h2>${HORIZONS[h]}</h2><span class="hint">${lot.length}</span></header>
                ${lot.map(ligneAction).join('')}
              </div>`;
    })
    .join('');

  const semaines = dernieresSemaines(8);
  const semaineCourante = lundiDe(new Date());

  const habitudes = state.actions.habitudes
    .map(
      (h) => `
      <div class="habit" data-habit-id="${esc(h.id)}">
        <h3>${esc(h.titre)}</h3>
        <p class="hint">${esc(h.pourquoi ?? '')}</p>
        <div class="weeks">
          ${semaines
            .map((s) => {
              const on = (h.completions ?? []).includes(s);
              return `<button class="week${s === semaineCourante ? ' current' : ''}" data-role="semaine"
                        data-semaine="${s}" data-on="${on}" title="Semaine du ${dateCourte(s)}">${s.slice(8)}/${s.slice(5, 7)}</button>`;
            })
            .join('')}
        </div>
      </div>`,
    )
    .join('');

  return `
    <div class="card">
      <header>
        <h2>Filtrer</h2>
        <div class="segmented">
          ${Object.entries(filtres)
            .map(([v, l]) => `<button data-role="filtre" data-valeur="${v}" aria-pressed="${ui.filtreStatut === v}">${l}</button>`)
            .join('')}
        </div>
      </header>
      <p class="hint">Cocher une action l'écrit immédiatement dans <code>data/actions.json</code>. Le fichier reste éditable à la main.</p>
    </div>
    ${parHorizon || '<p class="empty">Aucune action pour ce filtre.</p>'}
    <div class="card">
      <header><h2>Habitudes hebdomadaires</h2><span class="hint">8 dernières semaines</span></header>
      ${habitudes || '<p class="empty">Aucune habitude définie.</p>'}
    </div>`;
}

function ligneCompetence(c) {
  const inconnu = c.ecart == null;
  const classe = inconnu ? 'unknown' : c.ecart > 0 ? 'gap' : 'ok';
  const texte = inconnu ? 'non évaluée' : c.ecart > 0 ? `écart +${c.ecart}` : 'atteint';
  const largeurRequis = c.requis == null ? 0 : (c.requis / 5) * 100;
  const largeurActuel = c.niveau_actuel == null ? 0 : (c.niveau_actuel / 5) * 100;

  return `
    <div class="skill">
      <div class="row">
        <span class="nom">${esc(c.nom)}</span>
        <span class="ecart ${classe}">${texte}</span>
      </div>
      <div class="bar">
        <span class="required" style="width:${largeurRequis}%"></span>
        <span class="current" style="width:${largeurActuel}%"></span>
      </div>
    </div>`;
}

function vueCompetences() {
  const liste = ecarts();
  const domaines = [...new Set(liste.map((c) => c.domaine))];

  const corps = domaines
    .map((d) => {
      const lot = liste
        .filter((c) => c.domaine === d)
        .sort((a, b) => poids(b.ecart) - poids(a.ecart));
      return `
        <div class="domain-title">${esc(d)}</div>
        ${lot
          .map(
            (c) => `
          <div class="skill" data-nom="${esc(c.nom)}">
            <div class="row">
              <span class="nom">${esc(c.nom)}</span>
              <span style="display:flex;align-items:center;gap:10px;flex:none">
                <span class="ecart ${c.ecart == null ? 'unknown' : c.ecart > 0 ? 'gap' : 'ok'}">
                  ${c.ecart == null ? 'à évaluer' : c.ecart > 0 ? `+${c.ecart}` : 'ok'}
                </span>
                <select data-role="niveau" aria-label="Mon niveau sur ${esc(c.nom)}" style="width:auto">
                  <option value=""${c.niveau_actuel == null ? ' selected' : ''}>${VIDE}</option>
                  ${[0, 1, 2, 3, 4, 5]
                    .map((n) => `<option value="${n}"${c.niveau_actuel === n ? ' selected' : ''}>${n}</option>`)
                    .join('')}
                </select>
              </span>
            </div>
            <div class="bar">
              <span class="required" style="width:${c.requis == null ? 0 : (c.requis / 5) * 100}%"></span>
              <span class="current" style="width:${c.niveau_actuel == null ? 0 : (c.niveau_actuel / 5) * 100}%"></span>
            </div>
            <div class="meta hint" style="margin-top:4px">
              requis ${c.requis ?? '?'}/5, ${esc(c.source_du_requis ?? '')}
              ${c.preuve ? `<div style="margin-top:3px">${esc(c.preuve)}</div>` : ''}
            </div>
          </div>`,
          )
          .join('')}`;
    })
    .join('');

  return `
    <div class="card">
      <header>
        <h2>Comparer à la cible</h2>
        <div class="segmented">
          <button data-role="cible" data-valeur="seniorite" aria-pressed="${ui.cibleAffichee === 'seniorite'}">Séniorité</button>
          <button data-role="cible" data-valeur="management" aria-pressed="${ui.cibleAffichee === 'management'}">Management</button>
        </div>
      </header>
      <p class="hint">
        Barre claire, niveau requis. Barre pleine, ton niveau. Les niveaux requis sont une hypothèse
        de départ, ils doivent être confrontés à des offres réelles déposées dans <code>inbox/</code>.
      </p>
      <p class="hint" style="margin-top:6px">
        Échelle : ${Object.entries(state.competences.echelle).map(([n, l]) => `<strong>${n}</strong> ${esc(l)}`).join(' | ')}
      </p>
    </div>
    <div class="card">${corps}</div>`;
}

function vueRealisations() {
  const liste = [...state.realisations.realisations].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const timeline = liste
    .map(
      (r) => `
      <div class="entry">
        <div class="date">${dateCourte(r.date)}${r.date_approximative ? ' <span class="faint">(à préciser)</span>' : ''}</div>
        <h3>${esc(r.titre)}</h3>
        ${r.contexte ? `<p class="hint">${esc(r.contexte)}</p>` : ''}
        ${r.impact ? `<p class="impact"><strong>Impact :</strong> ${esc(r.impact)}</p>` : ''}
        ${r.preuve ? `<p class="hint">Preuve : ${esc(r.preuve)}</p>` : ''}
        ${(r.a_completer ?? []).length
          ? `<p class="hint" style="color:var(--attention);margin-top:6px">À compléter, ${r.a_completer.map((x) => esc(x)).join(' · ')}</p>`
          : ''}
        ${r.note ? `<p class="hint"><em>${esc(r.note)}</em></p>` : ''}
        ${(r.competences_demontrees ?? []).length
          ? `<div class="chips">${r.competences_demontrees.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>`
          : ''}
      </div>`,
    )
    .join('');

  return `
    <div class="card">
      <header><h2>Consigner une réalisation</h2><span class="hint">30 secondes, au fil de l'eau</span></header>
      <form class="stack" id="form-realisation">
        <label>Date
          <input type="date" name="date" value="${aujourdhui()}" required>
        </label>
        <label>Titre, ce que j'ai fait
          <input type="text" name="titre" placeholder="Repris le pilotage du lot X après le départ du chef de projet" required>
        </label>
        <label>Contexte, la difficulté réelle
          <textarea name="contexte" placeholder="Ce qui rendait la chose non triviale, délai, périmètre, tension client"></textarea>
        </label>
        <label>Impact, chiffré si possible
          <input type="text" name="impact" placeholder="Livraison tenue à J+0, 3 personnes coordonnées, 0 régression">
        </label>
        <label>Preuve opposable
          <input type="text" name="preuve" placeholder="Mail du client du 12/03, ticket JIRA, compte-rendu de comité">
        </label>
        <label>Compétences démontrées, séparées par des virgules
          <input type="text" name="competences" placeholder="Pilotage de planning, Relation client">
        </label>
        <div class="actions-row">
          <button class="btn primary" type="submit">Ajouter</button>
          <button class="btn" type="button" data-role="export">${ui.exportVisible ? 'Masquer' : 'Exporter en markdown'}</button>
        </div>
      </form>
    </div>

    ${ui.exportVisible
      ? `<div class="card">
           <header><h2>Export markdown</h2>
             <button class="btn" data-role="copier">Copier</button>
           </header>
           <pre class="export" id="export-md">${esc(exporterMarkdown())}</pre>
         </div>`
      : ''}

    <div class="card">
      <header><h2>Historique</h2><span class="hint">${liste.length} réalisation(s)${(() => { const n = liste.filter((r) => (r.a_completer ?? []).length).length; return n ? `, ${n} à compléter` : ''; })()}</span></header>
      ${timeline
        ? `<div class="timeline">${timeline}</div>`
        : `<p class="empty">Rien de consigné pour l'instant.</p>`}
    </div>`;
}

function exporterMarkdown() {
  const liste = [...state.realisations.realisations].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (!liste.length) return 'Aucune réalisation consignée.';
  const lignes = [`# Réalisations, ${state.profil.nom ?? ''}`, ''];
  for (const r of liste) {
    lignes.push(`## ${r.titre}`);
    lignes.push(`*${dateCourte(r.date)}*`);
    if (r.contexte) lignes.push('', `**Contexte.** ${r.contexte}`);
    if (r.impact) lignes.push('', `**Impact.** ${r.impact}`);
    if (r.preuve) lignes.push('', `**Preuve.** ${r.preuve}`);
    if ((r.competences_demontrees ?? []).length) {
      lignes.push('', `**Compétences.** ${r.competences_demontrees.join(', ')}`);
    }
    lignes.push('');
  }
  return lignes.join('\n');
}

function vueCible() {
  const cartes = Object.entries(state.cible.trajectoires)
    .map(([clef, t]) => {
      const active = clef === state.cible.cible_active;
      const liste = (arr, vide) =>
        (arr ?? []).length
          ? `<ul class="plain">${arr.map((x) => `<li>${esc(typeof x === 'string' ? x : x.titre ?? '')}</li>`).join('')}</ul>`
          : vide ? `<p class="faint hint">${vide}</p>` : '';

      // Une section qui n'a rien a dire ne dit rien. La trajectoire management
      // n'a ni poste arrete ni jalons, et afficher quatre lignes de « a trancher »
      // fait douter du reste de la page, qui lui est solide.
      const bloc = (titre, contenu) => (contenu ? `<h3 style="margin-top:14px">${titre}</h3>${contenu}` : '');

      const jalons = (t.jalons ?? []).length
        ? `<ul class="plain">${t.jalons
            .map((j) => `<li>${esc(j.titre ?? j)}${j.date ? ` <span class="faint">${dateCourte(j.date)}</span>` : ''}</li>`)
            .join('')}</ul>`
        : '';

      const ligne = (dt, dd) => (dd ? `<dt>${dt}</dt><dd>${dd}</dd>` : '');
      const remuneration = renseigne(t.remuneration_visee?.min) ? formatRemuneration(t.remuneration_visee) : '';

      return `
        <div class="card"${active ? ' style="border-color: var(--accent)"' : ''}>
          <header>
            <h2>${esc(t.libelle)}</h2>
            ${active
              ? '<span class="prio prio-1">cible active</span>'
              : `<button class="btn" data-role="activer" data-valeur="${esc(clef)}">Activer</button>`}
          </header>
          <dl class="kv">
            ${ligne('Poste visé', renseigne(t.intitule_vise) ? esc(t.intitule_vise) : '')}
            ${ligne('Horizon', t.horizon_mois ? `${esc(t.horizon_mois)} mois` : '')}
            ${ligne('Rémunération', remuneration)}
          </dl>
          ${!renseigne(t.intitule_vise) && (t.pistes_a_trancher ?? []).length
            ? `<h3 style="margin-top:14px">Pistes à trancher</h3>
               <ul class="plain">${t.pistes_a_trancher.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
            : ''}
          ${bloc('Prérequis', liste(t.prerequis, ''))}
          ${bloc('Jalons', jalons)}
          ${bloc('Risques', liste(t.cout_reel?.risques, ''))}
          ${bloc('Arbitrages personnels', liste(t.cout_reel?.arbitrages_perso, ''))}
        </div>`;
    })
    .join('');

  return `
    <div class="card">
      <header><h2>Deux trajectoires, pas une</h2></header>
      <p class="hint">
        Séniorité et management partagent beaucoup de prérequis mais divergent sur l'essentiel,
        l'une récompense la profondeur, l'autre la capacité à obtenir des résultats par d'autres.
        Aucune fourchette de rémunération n'est affichée ici tant qu'elle n'a pas de source vérifiable.
      </p>
    </div>
    <div class="grid cols-2">${cartes}</div>
    ${vueReferencesMarche()}`;
}

function vueReferencesMarche() {
  const r = state.cible.references_marche;
  if (!r) return '';

  const s = r.grille_conventionnelle;
  const brutMensuel = state.profil.remuneration?.brut_mensuel_base;

  // Les minima conventionnels sont la seule reference contractuellement opposable,
  // on les montre en premier et on situe le salaire reel par rapport a chacun.
  const grille = (s?.points ?? [])
    .map((p) => {
      const ecart = brutMensuel == null ? null : brutMensuel - p.minimum_mensuel;
      const classe = ecart == null ? 'unknown' : ecart >= 0 ? 'ok' : 'gap';
      const texte = ecart == null ? VIDE : `${ecart >= 0 ? '+' : ''}${Math.round(ecart)} € / mois`;
      return `
        <div class="skill">
          <div class="row">
            <span class="nom">Position ${esc(p.position)}, coefficient ${esc(p.coefficient)}</span>
            <span class="ecart ${classe}" style="flex:none">${texte}</span>
          </div>
          <div class="meta hint" style="margin-top:4px">
            plancher ${euros(p.minimum_mensuel)}/mois, ${euros(p.minimum_annuel)}/an
          </div>
          ${p.commentaire ? `<div class="note hint" style="margin-top:4px">${esc(p.commentaire)}</div>` : ''}
        </div>`;
    })
    .join('');

  const constat = (texte, couleur) =>
    texte ? `<p class="hint" style="border-left:3px solid var(${couleur}); padding-left:10px; margin-top:12px">${esc(texte)}</p>` : '';

  return `
    <div class="card" style="border-color: var(--accent)">
      <header>
        <h2>Grille ${esc(dit.convention())}, opposable</h2>
        <span class="hint">minima 2026</span>
      </header>
      <p class="hint">
        Ce sont des <strong>planchers contractuels</strong>, pas des objectifs. C'est la seule référence
        qu'on ne peut pas écarter d'un « ce n'est pas notre politique ».
      </p>
      <div style="margin-top:12px">${grille}</div>
      ${constat(s?.constat_cle, '--danger')}
      <p class="hint" style="margin-top:10px">
        Source : ${s?.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.source)}</a>` : esc(s?.source ?? '')}
      </p>
    </div>`;
}

function vueNotes() {
  if (!state.notes.length) {
    return `<div class="empty"><strong>Aucune note.</strong><br>Les notes portent le raisonnement, pas les données. Dépose des fichiers markdown dans <code>notes/</code>, ils apparaîtront ici.</div>`;
  }

  const joli = (nom) =>
    nom.replace(/\.md$/, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

  const selecteur = `
    <div class="card">
      <header>
        <h2>Notes</h2>
        <span class="hint">${state.notes.length} document(s)</span>
      </header>
      <div class="segmented" style="flex-wrap:wrap">
        ${state.notes
          .map(
            (n) => `<button data-role="note" data-nom="${esc(n.nom)}" aria-pressed="${ui.noteActive === n.nom}">${esc(joli(n.nom))}</button>`,
          )
          .join('')}
      </div>
      <p class="hint" style="margin-top:10px">
        Chaque bloc encadré est un texte à coller dans ${esc(dit.outilRh())}, le bouton Copier le met dans le presse-papier.
        Les notes restent des fichiers markdown dans <code>notes/</code>, éditables à la main.
      </p>
    </div>`;

  const contenu = state.noteContenu[ui.noteActive];
  const corps =
    contenu === undefined
      ? '<p class="empty">Chargement…</p>'
      : `<div class="card md">${markdown(contenu)}</div>`;

  return selecteur + corps;
}

const STATUTS_ENGAGEMENT = {
  tenu: { libelle: 'Tenu', classe: 'ok' },
  partiellement_tenu: { libelle: 'Partiellement tenu', classe: 'gap' },
  non_tenu: { libelle: 'Non tenu', classe: 'gap' },
  en_attente: { libelle: 'En attente', classe: 'unknown' },
};

// Ce que l'employeur a promis. C'est la vue qui rend visible ce qui, en 2025,
// s'est evapore faute de suivi.
function vueEngagements() {
  const liste = [...(state.engagements?.engagements ?? [])].sort((a, b) =>
    (b.date_engagement ?? '').localeCompare(a.date_engagement ?? ''),
  );
  if (!liste.length) {
    return `<div class="empty"><strong>Aucun engagement consigné.</strong><br>C'est le fichier qui évite de recommencer la même conversation chaque année. Consigne ici toute promesse reçue, avec sa date et sa pièce. Lance <code>/demarrer</code>, ou édite <code>data/engagements.json</code>.</div>`;
  }

  const compte = (s) => liste.filter((e) => e.statut === s).length;

  const cartes = liste
    .map((e) => {
      const s = STATUTS_ENGAGEMENT[e.statut] ?? STATUTS_ENGAGEMENT.en_attente;
      return `
        <div class="skill">
          <div class="row">
            <span class="nom"><strong>${esc(e.quoi)}</strong></span>
            <span class="ecart ${s.classe}" style="flex:none">${s.libelle}</span>
          </div>
          <div class="meta hint" style="margin-top:6px">
            ${esc(e.qui ?? '')}, ${dateCourte(e.date_engagement)}${e.echeance_annoncee ? `, échéance ${esc(e.echeance_annoncee)}` : ''}
          </div>
          ${e.constat ? `<p class="hint" style="margin-top:8px">${esc(e.constat)}</p>` : ''}
          ${e.suite ? `<p class="hint" style="margin-top:6px"><strong>Suite.</strong> ${esc(e.suite)}</p>` : ''}
          ${e.lecon ? `<p class="hint faint" style="margin-top:6px"><em>${esc(e.lecon)}</em></p>` : ''}
          ${e.source ? `<p class="hint faint" style="margin-top:6px">Source, ${esc(e.source)}</p>` : ''}
        </div>`;
    })
    .join('');

  return `
    <div class="grid cols-3">
      <div class="card stat">
        <span class="label">Non tenus</span>
        <span class="value">${compte('non_tenu')}</span>
        <span class="note">à reposer au prochain cycle</span>
      </div>
      <div class="card stat">
        <span class="label">En attente</span>
        <span class="value">${compte('en_attente')}</span>
        <span class="note">sans échéance ou non échus</span>
      </div>
      <div class="card stat">
        <span class="label">Tenus</span>
        <span class="value">${compte('tenu') + compte('partiellement_tenu')}</span>
        <span class="note">dont ${compte('partiellement_tenu')} partiellement</span>
      </div>
    </div>

    <div class="card">
      <header><h2>Ce qui a été promis</h2><span class="hint">${liste.length} engagement(s)</span></header>
      <p class="hint" style="margin-bottom:14px">
        En 2025, un engagement chiffré existait dans un document signé. Personne ne l'a suivi, et il a fallu un an
        pour s'en apercevoir. Cette page existe pour que cela ne se reproduise pas.
      </p>
      ${cartes}
    </div>

    <div class="card">
      <header><h2>À vérifier à chaque cycle</h2></header>
      <ul class="plain">${(state.engagements?._a_verifier_a_chaque_cycle ?? []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>`;
}

// Echelle commune a toutes les fourchettes, pour qu'elles soient comparables d'un
// coup d'oeil. Bornes fixes plutot que calculees, sinon l'ajout d'une offre
// deplacerait toutes les barres et casserait la lecture d'un releve a l'autre.
const ECHELLE = { min: 35000, max: 60000 };
const position = (v) => ((v - ECHELLE.min) / (ECHELLE.max - ECHELLE.min)) * 100;

// Les offres du marche, comparees a perimetre egal. Un brut annonce ne se compare
// pas au package actuel, il faut convertir les avantages nets avec le coefficient.
function vueOffres() {
  const o = state.offres;
  if (!o) return '<p class="empty">Aucune donnée de marché.</p>';
  const ref = o.reference;

  const visee = state.cible.trajectoires[ui.cibleAffichee]?.remuneration_visee;
  const pkg = state.profil.remuneration?.package;

  // Deux bases de lecture. Brut contre brut est la seule symetrique, puisque les
  // annonces publient un brut sans detailler leurs propres avantages. La base
  // package est proposee pour information, avec son avertissement.
  const BASES = {
    brut: {
      libelle: 'Brut contre brut',
      toi: state.profil.remuneration?.brut_annuel_total ?? 0,
      demande: (visee?.demande_annoncee_mensuel ?? 0) * 12,
    },
    package: {
      libelle: 'Package contre brut annoncé',
      toi: pkg?.totaux?.package_en_equivalent_brut ?? 0,
      demande: visee?.package_equivalent_brut ?? 0,
    },
  };
  const base = BASES[ui.baseComparaison] ?? BASES.brut;
  const { toi: valeurToi, demande: valeurDemande } = base;

  const retenues = (o.offres ?? []).filter((x) => x.fourchette === 'annoncee');
  const ecartees = (o.offres ?? []).filter((x) => x.fourchette !== 'annoncee');

  const equivalent = (x) =>
    (x.brut_max ?? x.brut_min ?? 0) + Math.round((x.avantages_nets_annuels ?? 0) * ref.coefficient_net_vers_brut);

  /* -- Le trace ---------------------------------------------------------------
     Tout ce qui porte une abscisse vit dans la colonne 2 de la grille, barres,
     points, graduations et calque des reperes. Un meme pourcentage y designe
     donc toujours le meme pixel. C'est ce qui manquait a la version precedente,
     ou les reperes se calaient sur le conteneur entier et les barres sur la
     seule piste, deux largeurs differentes.                                   */

  const rangees = retenues
    .map((x) => {
      const g = position(x.brut_min);
      const l = position(x.brut_max) - g;
      return `
        <div class="plage-nom">${esc(x.employeur)}</div>
        <div class="plage-piste">
          <div class="plage-barre" style="left:${g}%;width:${l}%"
               title="${esc(x.employeur)}, ${esc(x.intitule)}, ${euros(x.brut_min)} à ${euros(x.brut_max)}"></div>
          <span class="plage-min" style="left:${g}%">${Math.round(x.brut_min / 1000)}k</span>
          <span class="plage-max" style="left:${g + l}%">${Math.round(x.brut_max / 1000)}k</span>
        </div>`;
    })
    .join('');

  const points = `
    <div class="plage-nom">Ta position</div>
    <div class="plage-piste">
      <span class="point point-toi" style="left:${position(valeurToi)}%" title="Toi, ${euros(valeurToi)}"></span>
      ${valeurDemande ? `<span class="point point-demande" style="left:${position(valeurDemande)}%" title="Ta demande, ${euros(valeurDemande)}"></span>` : ''}
    </div>`;

  const graduations = [35, 40, 45, 50, 55, 60]
    .map((k) => `<span class="graduation" style="left:${position(k * 1000)}%">${k}k</span>`)
    .join('');

  // Etiquettes au dessus du trace, l'axe reste seul en bas. Quand les deux
  // reperes se touchent, la seconde etiquette monte d'un cran.
  const serres = valeurDemande && Math.abs(position(valeurDemande) - position(valeurToi)) < 16;
  const repere = (valeur, libelle, classe, haut) => `
    <div class="repere ${classe}" style="left:${position(valeur)}%">
      <span class="repere-etiquette" style="top:${haut}px">${libelle}<br><strong>${euros(valeur)}</strong></span>
    </div>`;

  return `
    <div class="card">
      <header>
        <h2>Où tu te situes</h2>
        <span class="hint">brut annuel, ${retenues.length} offres à fourchette annoncée</span>
      </header>

      <div class="bascule" role="radiogroup" aria-label="Base de comparaison">
        ${Object.entries(BASES)
          .map(
            ([cle, b]) => `<label class="bascule-choix">
              <input type="radio" name="base" value="${cle}" data-role="base"${ui.baseComparaison === cle ? ' checked' : ''}>
              <span>${b.libelle}</span>
            </label>`,
          )
          .join('')}
      </div>

      <div class="plage">
        <div class="plage-calque">
          ${repere(valeurToi, 'toi', 'repere-toi', serres ? 0 : 6)}
          ${valeurDemande ? repere(valeurDemande, 'ta demande', 'repere-demande', serres ? 32 : 6) : ''}
        </div>
        ${rangees}
        ${points}
        <div class="plage-nom"></div>
        <div class="plage-axe">${graduations}</div>
      </div>

      <p class="hint" style="margin-top:20px">
        ${esc(ref.regle_alignement ?? '')}
      </p>

      ${ui.baseComparaison === 'package'
        ? `<p class="hint alerte-base">
             ⚠️ Lecture asymétrique. Les annonces publient un brut sans détailler leurs tickets restaurant,
             leur participation ou leur intéressement. Comparer ton package complet à leur brut partiel te
             désavantage, et ta demande passe au dessus du marché alors qu'elle est en dessous à brut comparable.
             Ne te sers jamais de cette base en entretien.
           </p>`
        : ''}
    </div>

    <div class="card">
      <header><h2>Les offres</h2></header>
      ${retenues
        .map((x) => {
          const ecart = equivalent(x) - ref.seuil_a_egaler;
          return `
        <div class="skill">
          <div class="nom" style="font-size:15px"><strong>${esc(x.intitule)}</strong></div>
          <div class="meta hint" style="margin-top:3px">
            ${esc(x.employeur)}, ${esc(x.type_employeur ?? '')}, ${esc(x.lieu ?? '')}${x.experience_demandee ? `, ${esc(x.experience_demandee)}` : ''}
          </div>
          <div class="row" style="margin-top:10px">
            <span class="hint"><strong>${euros(x.brut_min)}</strong> à <strong>${euros(x.brut_max)}</strong></span>
            <span class="ecart ${ecart >= 0 ? 'ok' : 'gap'}" style="flex:none">${ecart >= 0 ? '+' : ''}${euros(ecart)} vs ton seuil</span>
          </div>
          ${x.url ? `<div class="meta hint" style="margin-top:6px"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">ouvrir l'annonce</a></div>` : ''}
          ${x.detail
            ? `<details class="etapes"${ui.offresOuvertes.has(x.employeur) ? ' open' : ''} data-role="offre" data-id="${esc(x.employeur)}">
                 <summary>Lire l'annonce</summary>
                 <div class="annonce">${esc(x.detail).split(String.fromCharCode(10)).join('<br>')}</div>
               </details>`
            : ''}
          ${x.pertinence ? `<p class="hint faint" style="margin-top:8px"><em>${esc(x.pertinence)}</em></p>` : ''}
        </div>`;
        })
        .join('') || '<p class="empty">Aucune offre à fourchette annoncée.</p>'}
    </div>

    ${ecartees.length
      ? `<div class="card">
           <header><h2>Écartée du comparatif</h2><span class="hint">${ecartees.length}</span></header>
           ${ecartees
             .map(
               (x) => `<div class="skill">
                 <div class="nom"><strong>${esc(x.intitule)}</strong>, ${esc(x.employeur)}</div>
                 <p class="hint" style="margin-top:6px">${esc(x.pertinence ?? '')}</p>
                 ${x.url ? `<div class="meta hint" style="margin-top:6px"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">ouvrir l'annonce</a></div>` : ''}
               </div>`,
             )
             .join('')}
         </div>`
      : ''}`;
}

// Ce qu'il reste a faire sur le formulaire avant de le partager. Les cases cochees
// sont ecrites sur disque, la liste sert donc de suivi et pas seulement d'affichage.
function vueInbox() {
  const bloc = (titre, fichiers, vide) => `
    <div class="card">
      <header><h2>${titre}</h2><span class="hint">${fichiers.length}</span></header>
      ${fichiers.length
        ? fichiers
            .map(
              (f) => `<div class="file">
                        <span>${esc(f.nom)} <span class="faint">${dateCourte(f.modifie)}</span></span>
                        <span class="size">${taille(f.taille)}</span>
                      </div>`,
            )
            .join('')
        : `<p class="empty">${vide}</p>`}
    </div>`;

  return `
    <div class="card">
      <p class="hint">
        Dépose tes documents dans <code>inbox/</code>. Je les lis, j'écris une synthèse dans <code>notes/</code>,
        puis je déplace la pièce dans <code>inbox/traites/</code>. Ces documents sont exclus de l'historique git.
      </p>
    </div>
    ${bloc('En attente de lecture', state.inbox.enAttente, 'Rien déposé pour le moment.')}
    ${bloc('Déjà traités', state.inbox.traites, 'Aucun fichier traité.')}`;
}

/* ----------------------------------------------------------- entrainement */

const ent = () => ui.entrainement;

/* -- exercice a choix -------------------------------------------------------
   Aucun modele ici. Les bonnes et les mauvaises reponses sont ecrites dans
   data/exercices.json, donc rien ne peut inventer un montant ni conseiller une
   faute. C'est ce qui rend cet exercice utilisable tout de suite, et fiable la
   ou le modele local ne l'est pas.                                           */

// Melange une fois par situation, sinon la bonne reponse serait toujours au meme
// rang et l'exercice se reduirait a memoriser une position.
function melanger(n) {
  const ordre = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
  }
  return ordre;
}

// La serie est enregistree une fois, a l'arrivee sur le bilan. L'ecriture sur
// disque part sans etre attendue, mais l'etat en memoire est mis a jour tout de
// suite pour que le rendu qui suit compte deja cette serie.
function enregistrerSerie(rep, total) {
  const x = ent().exercice;
  if (x.enregistree) return;
  x.enregistree = true;

  const fautes = {};
  for (const r of rep.filter((y) => !y.bon)) fautes[r.faute] = (fautes[r.faute] ?? 0) + 1;

  state.entrainement.series ??= [];
  state.entrainement.series.unshift({
    date: new Date().toISOString(),
    justes: rep.filter((y) => y.bon).length,
    total,
    fautes,
  });
  // Vingt series suffisent a voir une tendance, au dela le fichier enfle pour rien.
  state.entrainement.series = state.entrainement.series.slice(0, 20);
  sauver('entrainement');
}

function bilanReflexes(rep, total) {
  enregistrerSerie(rep, total);

  const series = state.entrainement.series ?? [];
  const justes = rep.filter((r) => r.bon).length;
  const rates = rep.filter((r) => !r.bon);

  const parFaute = new Map();
  for (const r of rates) parFaute.set(r.faute, (parFaute.get(r.faute) ?? 0) + 1);
  const duJour = [...parFaute.entries()].sort((a, b) => b[1] - a[1]);

  // Le vrai enseignement n'est pas la faute d'aujourd'hui, c'est celle qui revient
  // d'une serie a l'autre. C'est elle qui est un reflexe et non une inattention.
  const surSeries = new Map();
  for (const s of series) {
    for (const f of Object.keys(s.fautes ?? {})) surSeries.set(f, (surSeries.get(f) ?? 0) + 1);
  }
  const tenaces = [...surSeries.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);

  const precedente = series[1];
  const delta = precedente ? justes - precedente.justes : null;
  const progression = delta === null
    ? '<span class="faint">première série</span>'
    : `série précédente ${precedente.justes} sur ${precedente.total}, ${
        delta > 0 ? `<span class="ecart ok">+${delta}</span>` : delta < 0 ? `<span class="ecart gap">${delta}</span>` : 'égalité'
      }`;

  const ligne = (libelle, valeur, classe) => `
    <div class="row" style="padding:9px 0;border-top:1px solid var(--trait)">
      <span class="hint">${esc(libelle)}</span>
      <span class="ecart ${classe}" style="flex:none">${valeur}</span>
    </div>`;

  return `
    <div class="card">
      <header>
        <h2>Bilan</h2>
        <span class="hint">${justes} sur ${total}, ${progression}</span>
      </header>

      ${rates.length === 0
        ? '<p class="hint">Sans faute sur cette série.</p>'
        : `<p class="hint">Les fautes de cette série, la plus fréquente d\'abord.</p>
           <div style="margin-top:12px">${duJour.map(([f, n]) => ligne(f, `${n} fois`, 'gap')).join('')}</div>`}

      ${tenaces.length
        ? `<h3 style="margin-top:22px">Ce qui revient d'une série à l'autre</h3>
           <p class="hint faint">Sur ${series.length} série${series.length > 1 ? 's' : ''} enregistrée${series.length > 1 ? 's' : ''}.</p>
           <div style="margin-top:10px">${tenaces.map(([f, n]) => ligne(f, `${n} séries`, 'gap')).join('')}</div>
           <p class="hint faint" style="margin-top:14px">
             Une faute qui revient sur deux séries n'est pas une inattention, c'est un réflexe à défaire.
             Relis la section 7 de la note d'entretien sur celle-là avant de recommencer.
           </p>`
        : series.length > 1
          ? '<p class="hint faint" style="margin-top:18px">Aucune faute ne revient d\'une série à l\'autre. C\'est le signe que tu es prêt.</p>'
          : ''}

      <div class="actions-row" style="margin-top:20px">
        <button class="btn primary" data-role="ent-recommencer">Refaire la série</button>
      </div>
    </div>`;
}

function vueReflexes() {
  const e = ent();
  const situations = state.exercices?.situations ?? [];
  if (!situations.length) return '<p class="empty">Aucun exercice chargé.</p>';

  const x = e.exercice;
  if (x.i >= situations.length) return bilanReflexes(x.reponses, situations.length);

  const s = situations[x.i];
  x.ordre ??= melanger(s.options.length);
  const repondu = x.choisi !== null;

  const options = x.ordre
    .map((k) => {
      const o = s.options[k];
      let classe = 'choix';
      if (repondu) {
        if (o.bon) classe += ' choix-bon';
        else if (k === x.choisi) classe += ' choix-mauvais';
        else classe += ' choix-neutre';
      }
      return `
        <button class="${classe}" data-role="ent-choix" data-k="${k}"${repondu ? ' disabled' : ''}>
          <span class="choix-texte">${esc(o.texte)}</span>
          ${repondu && (o.bon || k === x.choisi)
            ? `<span class="choix-motif">
                 ${o.bon ? '<strong>La bonne réponse.</strong>' : `<strong>${esc(o.faute)}.</strong>`}
                 ${esc(o.pourquoi)}
               </span>`
            : ''}
        </button>`;
    })
    .join('');

  const justes = x.reponses.filter((r) => r.bon).length;

  return `
    <div class="card">
      <header>
        <h2>Réflexes</h2>
        <span class="entete-droite">
          <span class="hint">${x.i + 1} sur ${situations.length}, ${justes} juste${justes > 1 ? 's' : ''}</span>
          ${x.i > 0 || x.choisi !== null
            ? '<button class="btn recommencer" data-role="ent-recommencer">Redémarrer</button>'
            : ''}
        </span>
      </header>

      <p class="hint faint" style="margin-top:-4px">
        Aucun modèle ici, les réponses sont écrites à l'avance, donc rien ne peut inventer un montant
        ni te conseiller une faute.
      </p>

      <div class="exo">
        <p class="exo-titre">${esc(s.titre)}</p>
        ${s.contexte ? `<p class="hint faint exo-contexte">${esc(s.contexte)}</p>` : ''}
        <div class="bulle">
          <span class="bulle-qui">${esc(dit.manager())}</span>
          <p>${esc(s.manager)}</p>
        </div>
        <div class="choix-liste">${options}</div>
        ${repondu
          ? `<div class="actions-row">
               <button class="btn primary" data-role="ent-suivant">
                 ${x.i + 1 >= situations.length ? 'Voir le bilan' : 'Suivant'}
               </button>
             </div>`
          : ''}
      </div>
    </div>`;
}

/* ---------------------------------------------------- reste a faire */

// Les echeances sont rangees par moment, pas par nature. Un jeudi matin a quatre
// jours de l'entretien, la question n'est pas « quelles sont mes actions » mais
// « qu'est-ce que je fais maintenant ».
function vueResteAFaire() {
  const jour = aujourdhui();
  const entretien = state.profil.prochain_entretien_annuel;
  const pf = state.formulaire?.partage;

  const champs = (state.formulaire?.champs ?? []).filter((c) => !c.fait);
  const ouvertes = (state.actions?.actions ?? []).filter((a) => a.statut !== 'fait' && a.statut !== 'abandonne');

  const MOMENTS = [
    { cle: 'maintenant', titre: 'Maintenant', borne: (a) => a.echeance && a.echeance <= jour },
    { cle: 'avant', titre: "Avant l'entretien", borne: (a) => a.echeance && a.echeance > jour && a.echeance < entretien },
    { cle: 'jour', titre: 'Le jour J', borne: (a) => a.echeance === entretien },
    { cle: 'apres', titre: 'Après', borne: (a) => a.echeance && a.echeance > entretien },
  ];

  // Un champ a coller est plus urgent qu'une action : il bloque le partage.
  const blocChamps = champs.length
    ? champs
        .map(
          (c) => `
        <div class="reste" data-champ-id="${esc(c.id)}">
          <button class="tick" data-role="champ" data-on="false" title="Marquer comme collé">✓</button>
          <div class="body">
            <div class="titre">${esc(c.champ)} <span class="faint">${esc(c.section)}</span></div>
            ${c.quoi ? `<div class="meta">${esc(c.quoi)}</div>` : ''}
            ${c.pourquoi ? `<p class="hint faint" style="margin-top:6px">${esc(c.pourquoi)}</p>` : ''}
            <div class="bloc-copiable" style="margin-top:10px">
              <button class="btn copier-bloc" data-role="copier-bloc">Copier</button>
              <blockquote><p>${esc(c.texte).split(String.fromCharCode(10)).join('<br>')}</p></blockquote>
            </div>
          </div>
        </div>`,
        )
        .join('')
    : '<p class="hint">Tous les champs sont appliqués.</p>';

  const partage = pf && !pf.fait
    ? `
      <div class="reste">
        <span class="tick" data-on="false" aria-hidden="true">✓</span>
        <div class="body">
          <div class="titre">Partager le formulaire à ${esc(dit.manager())}</div>
          <div class="meta">${dateCourte(pf.date_recommandee)} ${esc(pf.moment)}${
            pf.date_recommandee < jour ? ' <span class="ecart gap">en retard</span>' : ''
          }</div>
          <div class="bloc-copiable" style="margin-top:10px">
            <button class="btn copier-bloc" data-role="copier-bloc">Copier</button>
            <blockquote><p>${esc(pf.message)}</p></blockquote>
          </div>
          <ul class="plain" style="margin-top:10px">${(pf.a_ne_pas_faire ?? [])
            .map((x) => `<li>${esc(x)}</li>`)
            .join('')}</ul>
        </div>
      </div>`
    : '';

  const ligneAction = (a) => `
    <div class="reste" data-action-id="${esc(a.id)}">
      <button class="tick" data-role="toggle" data-on="false" title="Marquer comme fait">✓</button>
      <div class="body">
        <div class="titre">${esc(a.titre)}</div>
        <div class="meta">${a.echeance ? dateCourte(a.echeance) : 'sans échéance'}${
          a.echeance && a.echeance < jour ? ' <span class="ecart gap">en retard</span>' : ''
        } <span class="faint">${esc(a.id)}</span></div>
        ${(a.etapes ?? []).length
          ? `<details class="etapes"${ui.etapesOuvertes.has(a.id) ? ' open' : ''} data-role="etapes" data-id="${esc(a.id)}">
               <summary>Pas à pas</summary>
               <ol>${a.etapes.map((e) => `<li>${esc(e)}</li>`).join('')}</ol>
             </details>`
          : ''}
      </div>
    </div>`;

  const sections = MOMENTS.map((m) => {
    const liste = ouvertes.filter(m.borne).sort((a, b) => (a.echeance ?? '').localeCompare(b.echeance ?? ''));
    const enTete = m.cle === 'maintenant' ? blocChamps + partage : '';
    if (!liste.length && !enTete) return '';
    return `
      <div class="card">
        <header>
          <h2>${m.titre}</h2>
          <span class="hint">${liste.length + (m.cle === 'maintenant' ? champs.length + (partage ? 1 : 0) : 0)} point(s)</span>
        </header>
        ${enTete}
        ${liste.map(ligneAction).join('')}
      </div>`;
  }).join('');

  const sansEcheance = ouvertes.filter((a) => !a.echeance);
  const jours = Math.round((new Date(entretien) - new Date(jour)) / 86400000);

  return `
    <div class="card">
      <header>
        <h2>Reste à faire</h2>
        <span class="hint">${jours > 0 ? `entretien dans ${jours} jour${jours > 1 ? 's' : ''}` : "jour de l'entretien"}</span>
      </header>
      <p class="hint">
        Ce que le cockpit ne fera pas à ta place, rangé par moment. Les champs à coller viennent du
        formulaire, le reste du plan d'action. Cocher ici écrit dans les mêmes fichiers.
      </p>
    </div>
    ${sections}
    ${sansEcheance.length
      ? `<div class="card">
           <header><h2>Sans échéance</h2><span class="hint">${sansEcheance.length}</span></header>
           ${sansEcheance.map(ligneAction).join('')}
           <p class="hint faint" style="margin-top:12px">Une action sans date n'est pas une action, c'est une intention.</p>
         </div>`
      : ''}`;
}

/* ----------------------------------------------------- discussions */

// Mes analyses, rangees de la plus recente a la plus ancienne. La premiere est
// depliee, les autres se deplient au clic, comme le pas a pas des actions.
// Elles vivent dans data/discussions.json et se rendent avec markdown(), le meme
// moteur que les notes, donc les blocs cites y sont copiables.
function vueDiscussions() {
  const entrees = state.discussions?.entrees ?? [];
  if (!entrees.length) {
    return `<div class="empty"><strong>Aucune analyse pour l'instant.</strong><br>Dépose une pièce dans <code>inbox/</code> puis dis <code>relis</code> à Claude. Il la lit, la recoupe avec ton dossier, et consigne son analyse ici.</div>`;
  }

  return `
    <div class="card">
      <header>
        <h2>Discussions</h2>
        <span class="hint">${entrees.length} analyse${entrees.length > 1 ? 's' : ''}</span>
      </header>
      <p class="hint">
        Ce que j'ai analysé au fil des pièces que tu as déposées. Les notes portent ce qu'il faut
        faire et dire, ces pages portent le raisonnement.
      </p>
    </div>
    ${entrees
      .map(
        (e, i) => `
      <div class="card">
        <details class="discussion"${i === 0 || ui.discussionsOuvertes.has(e.id) ? ' open' : ''} data-role="discussion" data-id="${esc(e.id)}">
          <summary>
            <span class="discussion-titre">${esc(e.titre)}</span>
            <span class="discussion-date">${dateCourte(e.date)}</span>
          </summary>
          ${e.source ? `<p class="hint faint discussion-source">${esc(e.source)}</p>` : ''}
          <div class="md">${markdown(e.contenu)}</div>
        </details>
      </div>`,
      )
      .join('')}`;
}

/* --------------------------------------------------- remuneration */

// Tout ce qui suit vient de data/paie.json, extrait des 53 fiches de paie, et de
// data/profil.json pour les avenants signes. Rien n'est estime : les six mois
// absents de mai a octobre 2023 restent un trou dans le trace, et les periodes
// dont aucune piece ne date la revalorisation sont dites non documentees plutot
// que reconstituees.

// Octobre 2021 est l'origine. On indexe par mois calendaire et non par rang dans
// le tableau, sinon le trou de 2023 se refermerait tout seul a l'affichage.
const MOIS_ZERO = { annee: 2021, mois: 10 };
const indexMois = (a, m) => (a - MOIS_ZERO.annee) * 12 + (m - MOIS_ZERO.mois);
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const moisLong = (p) => `${MOIS_COURT[p.mois - 1]} ${p.annee}`;

const eur0 = (n) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const eur2 = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dec = (n, d) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

// La classification telle qu'elle est ecrite sur le bulletin, normalisee pour
// que "POS 1-1" et "Position 1-1" ne comptent pas pour deux paliers differents.
const classe = (fiche) => `${String(fiche.position).replace(/^\D+/, '').replace('-', '.')} / ${fiche.coefficient}`;

function vueRemuneration() {
  const p = state.paie;
  if (!p?.fiches?.length) {
    return `<div class="empty"><strong>Aucun bulletin de paie extrait.</strong><br>Cette vue reconstruit ta trajectoire de rémunération à partir de tes bulletins. Dépose-les dans <code>inbox/</code> et lance <code>/demarrer</code>. Le module <code>france</code> fournit l'extracteur de bulletins français.</div>`;
  }

  const f = p.fiches;
  const premier = f[0];
  const dernier = f.at(-1);
  const iFin = indexMois(dernier.annee, dernier.mois);
  const somme = (c) => f.reduce((t, x) => t + (x[c] ?? 0), 0);

  const brutTotal = somme('brut');
  const netTotal = somme('net_paye');
  const impotTotal = somme('impot_preleve');
  const coutTotal = somme('cout_employeur');

  /* -- les revalorisations, uniquement celles qu'une piece date -------------
     Deux sources et deux seulement. La base contractuelle imprimee sur les
     bulletins d'avant mai 2023, et les avenants signes consignes dans profil.
     Entre les deux, le brut monte sans qu'aucune piece ne date la hausse, et
     c'est dit tel quel plutot que comble.                                    */
  const remu = state.profil.remuneration;
  const revalos = [];
  let basePrec = null;
  for (const fiche of f) {
    if (fiche.base_contractuelle == null) continue;
    if (basePrec != null && fiche.base_contractuelle !== basePrec.valeur) {
      revalos.push({
        i: indexMois(fiche.annee, fiche.mois),
        quand: moisLong(fiche),
        de: basePrec.valeur,
        vers: fiche.base_contractuelle,
        taux: ((fiche.base_contractuelle / basePrec.valeur - 1) * 100),
        source: 'base contractuelle du bulletin',
      });
    }
    basePrec = { valeur: fiche.base_contractuelle };
  }

  const septembre = remu.avant_octobre_2025.brut_bulletin_mensuel;
  const avenant25 = remu.historique.find((x) => x.effet === '2025-10-01');
  const base25 = avenant25.base_annuelle / 12;
  const base26 = remu.brut_annuel_base / 12;

  revalos.push(
    {
      i: indexMois(2025, 10), quand: 'oct. 2025', de: septembre, vers: base25,
      taux: avenant25.variation_vs_precedent_pct, source: 'avenant Technical Specialist',
    },
    {
      i: indexMois(2026, 3), quand: 'mars 2026', de: base25, vers: base26,
      taux: remu.historique.at(-1).variation_vs_precedent_pct, source: 'avenant du 16/03/2026',
    },
  );

  const tauxMax = Math.max(...revalos.map((r) => r.taux));
  const derniereBase = f.filter((x) => x.base_contractuelle != null).at(-1);

  // Les deux moities du parcours, coupees la ou les bulletins cessent d'imprimer
  // la base contractuelle. Le point de coupe n'est pas choisi, il est subi.
  const premiereBase = f.find((x) => x.base_contractuelle != null);
  const iPremiere = indexMois(premiereBase.annee, premiereBase.mois);
  const iDerniere = indexMois(derniereBase.annee, derniereBase.mois);
  const debut = {
    mois: iDerniere - iPremiere,
    hausse: (derniereBase.base_contractuelle / premiereBase.base_contractuelle - 1) * 100,
  };
  const suite = {
    mois: indexMois(2026, 3) - iDerniere,
    hausse: (base26 / derniereBase.base_contractuelle - 1) * 100,
  };
  const annuel = (x) => (((1 + x.hausse / 100) ** (12 / x.mois)) - 1) * 100;
  // Mois en toutes lettres, les deux paragraphes ci-dessous sont de la prose et
  // la forme abregee y produirait des elisions fautives.
  const moisPlein = (x) => `${['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][x.mois - 1]} ${x.annee}`;

  // La couverture des archives. Elle a change le 26/09, quand les six bulletins
  // de mai a octobre 2023 sont arrives et ont referme le seul trou de la serie.
  const noteTrous = p.trous.length
    ? p.trous.length + " mois manquent encore aux archives, la courbe s'interrompt franchement plutot que de les inventer."
    : 'Aucun mois ne manque, les ' + f.length + " bulletins se suivent sans interruption d'" + moisLong(premier) + ' à ' + moisLong(dernier) + '.';

  /* -- la contrefactuelle --------------------------------------------------
     L'engagement de septembre 2025 portait sur 10 a 12 %. On l'applique au
     salaire de septembre 2025, puis on lui ajoute les 2 % de mars 2026
     reellement accordes. C'est une RECONSTITUTION, etiquetee comme telle.    */
  const iOct25 = indexMois(2025, 10);
  const iMars26 = indexMois(2026, 3);
  const moisAvant = iMars26 - iOct25;
  const moisApres = iFin - iMars26 + 1;
  const cf = {
    bas: { avant: septembre * 1.1, apres: septembre * 1.1 * 1.02 },
    haut: { avant: septembre * 1.12, apres: septembre * 1.12 * 1.02 },
  };
  const manque = {
    bas: moisAvant * (cf.bas.avant - base25) + moisApres * (cf.bas.apres - base26),
    haut: moisAvant * (cf.haut.avant - base25) + moisApres * (cf.haut.apres - base26),
  };

  /* -- graphique principal, le brut mensuel verse -------------------------- */

  const L = 52, R = 96, T = 18, B = 30, W = 880, H = 300;
  const bas = 1600, haut = 4000;
  const gx = (i) => L + (i / iFin) * (W - L - R);
  const gy = (v) => T + (1 - (v - bas) / (haut - bas)) * (H - T - B);

  // Le panneau de l'impot, accole sous le principal. Il partage exactement le
  // meme axe des temps, gx, mais il a sa PROPRE echelle verticale : l'impot
  // plafonne a 198 EUR quand le brut depasse 3 900. Sur un axe commun il serait
  // ecrase sur la ligne du bas et n'apprendrait rien. Deux cadres plutot qu'un
  // second axe dans le meme cadre, qui ferait mentir les proportions.
  const iH = 132, iB = 26, iHaut = 220;
  const gyI = (v) => T + (1 - v / iHaut) * (iH - T - iB);
  const maxImpot = Math.max(...f.map((x) => x.impot_preleve));
  const maxBrut = Math.max(...f.map((x) => x.brut));

  // Le chemin se coupe des que deux fiches ne se suivent pas, ce qui rend le
  // trou de 2023 visible au lieu de le masquer par un segment droit.
  const tracer = (champ, y) => {
    let d = '';
    let precedent = null;
    for (const fiche of f) {
      const i = indexMois(fiche.annee, fiche.mois);
      d += `${precedent !== null && i === precedent + 1 ? 'L' : 'M'}${gx(i).toFixed(1)} ${y(fiche[champ]).toFixed(1)} `;
      precedent = i;
    }
    return d.trim();
  };
  const chemin = tracer('brut', gy);
  const cheminNet = tracer('net_paye', gy);
  const cheminImpot = tracer('impot_preleve', gyI);

  const points = f
    .map((fiche) => {
      const i = indexMois(fiche.annee, fiche.mois);
      return `<circle class="pt" cx="${gx(i).toFixed(1)}" cy="${gy(fiche.brut).toFixed(1)}" r="2.6"><title>${esc(`${moisLong(fiche)} — ${eur2(fiche.brut)} bruts, ${eur2(fiche.net_paye)} nets`)}</title></circle>`;
    })
    .join('');

  const grilleY = [2000, 2500, 3000, 3500, 4000]
    .map((v) => `<line class="grille" x1="${L}" x2="${W - R}" y1="${gy(v).toFixed(1)}" y2="${gy(v).toFixed(1)}"></line>`
      + `<text class="axe-y" x="${L - 8}" y="${(gy(v) + 4).toFixed(1)}">${(v / 1000).toLocaleString('fr-FR')}k</text>`)
    .join('');

  const grilleImpot = [0, 100, 200]
    .map((v) => `<line class="grille" x1="${L}" x2="${W - R}" y1="${gyI(v).toFixed(1)}" y2="${gyI(v).toFixed(1)}"></line>`
      + `<text class="axe-y" x="${L - 8}" y="${(gyI(v) + 4).toFixed(1)}">${v}</text>`)
    .join('');

  const grilleX = [2022, 2023, 2024, 2025, 2026]
    .map((a) => `<text class="axe-x" x="${gx(indexMois(a, 1)).toFixed(1)}" y="${H - 10}">${a}</text>`)
    .join('');

  // Les reperes datés, un par piece. Le changement de classification vient des
  // bulletins eux-memes, les deux autres des avenants signes.
  const REPERES = [
    { i: indexMois(2022, 9), t: '+10,01 %' },
    { i: indexMois(2023, 10), t: '+6,05 %' },
    { i: indexMois(2024, 10), t: 'coef 130' },
    { i: indexMois(2025, 10), t: '+2,62 %' },
    { i: indexMois(2026, 3), t: '+2,00 %' },
  ];
  const reperes = REPERES
    .map((r) => `<line class="repere" x1="${gx(r.i).toFixed(1)}" x2="${gx(r.i).toFixed(1)}" y1="${T + 12}" y2="${H - B}"></line>`
      + `<text class="repere-txt" x="${gx(r.i).toFixed(1)}" y="${T + 6}">${r.t}</text>`)
    .join('');

  /* -- graphique de la contrefactuelle, base contre base ------------------- */

  const cW = 880, cH = 190, cL = 52, cR = 120, cT = 16, cB = 26;
  const cBas = 3000, cHaut = 3500;
  const cx = (i) => cL + ((i - iOct25) / (iFin - iOct25)) * (cW - cL - cR);
  const cy = (v) => cT + (1 - (v - cBas) / (cHaut - cBas)) * (cH - cT - cB);
  const marche = (avant, apres) =>
    `M${cx(iOct25).toFixed(1)} ${cy(avant).toFixed(1)} L${cx(iMars26).toFixed(1)} ${cy(avant).toFixed(1)} `
    + `L${cx(iMars26).toFixed(1)} ${cy(apres).toFixed(1)} L${cx(iFin).toFixed(1)} ${cy(apres).toFixed(1)}`;
  const aire =
    `${marche(cf.haut.avant, cf.haut.apres)} L${cx(iFin).toFixed(1)} ${cy(base26).toFixed(1)} `
    + `L${cx(iMars26).toFixed(1)} ${cy(base26).toFixed(1)} L${cx(iMars26).toFixed(1)} ${cy(base25).toFixed(1)} `
    + `L${cx(iOct25).toFixed(1)} ${cy(base25).toFixed(1)} Z`;

  const cGrille = [3000, 3100, 3200, 3300, 3400, 3500]
    .map((v) => `<line class="grille" x1="${cL}" x2="${cW - cR}" y1="${cy(v).toFixed(1)}" y2="${cy(v).toFixed(1)}"></line>`
      + `<text class="axe-y" x="${cL - 8}" y="${(cy(v) + 4).toFixed(1)}">${(v / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1 })}k</text>`)
    .join('');

  /* -- les paliers de classification --------------------------------------- */

  const paliers = [];
  for (const fiche of f) {
    const cl = classe(fiche);
    const last = paliers.at(-1);
    if (!last || last.cl !== cl) paliers.push({ cl, de: fiche, a: fiche, emplois: [fiche.emploi] });
    else {
      last.a = fiche;
      if (!last.emplois.includes(fiche.emploi)) last.emplois.push(fiche.emploi);
    }
  }
  const frise = paliers
    .map((pa) => {
      const d = indexMois(pa.de.annee, pa.de.mois);
      const a = indexMois(pa.a.annee, pa.a.mois);
      return `
        <div class="palier" style="flex:${a - d + 1}">
          <div class="palier-barre"></div>
          <div class="palier-cl">${esc(pa.cl)}</div>
          <div class="palier-meta">${esc(pa.emplois.join(' puis '))}</div>
          <div class="palier-meta faint">${moisLong(pa.de)} → ${moisLong(pa.a)}, ${a - d + 1} mois</div>
        </div>`;
    })
    .join('');

  /* -- annee par annee ------------------------------------------------------ */

  const annees = [...new Set(f.map((x) => x.annee))].sort();
  const parAnnee = annees.map((a) => {
    const lot = f.filter((x) => x.annee === a);
    const t = (c) => lot.reduce((s, x) => s + x[c], 0);
    return { annee: a, mois: lot.length, brut: t('brut'), net: t('net_paye'), impot: t('impot_preleve'), cout: t('cout_employeur') };
  });
  const maxCout = Math.max(...parAnnee.map((a) => a.cout));
  const barres = parAnnee
    .map((a) => {
      const w = (v) => `${((v / maxCout) * 100).toFixed(2)}%`;
      return `
        <div class="an">
          <div class="an-titre">${a.annee}<span class="faint"> · ${a.mois} mois</span></div>
          <div class="an-pistes">
            <div class="piste"><span class="seg cout" style="width:${w(a.cout)}"></span><b>${eur0(a.cout)}</b></div>
            <div class="piste"><span class="seg brut" style="width:${w(a.brut)}"></span><b>${eur0(a.brut)}</b></div>
            <div class="piste"><span class="seg net" style="width:${w(a.net)}"></span><b>${eur0(a.net)}</b></div>
            <div class="piste"><span class="seg impot" style="width:${w(a.impot)}"></span><b>${eur0(a.impot)}</b></div>
          </div>
        </div>`;
    })
    .join('');

  const tuile = (label, valeur, note) =>
    `<div class="card stat"><span class="label">${label}</span><span class="value">${valeur}</span><span class="note">${note}</span></div>`;

  /* -- rendu ---------------------------------------------------------------- */

  return `
    <div class="grid cols-3">
      ${tuile('Brut cumulé', eur0(brutTotal), `${f.length} bulletins, ${moisLong(premier)} → ${moisLong(dernier)}`)}
      ${tuile('Net réellement perçu', eur0(netTotal), `${dec((netTotal / brutTotal) * 100, 1)} % du brut`)}
      ${tuile('Impôt prélevé à la source', eur0(impotTotal), `taux actuel ${pct(dernier.taux_prelevement)}`)}
    </div>

    <div class="grid cols-2">
      ${tuile("Ce que tu coûtes à l'employeur", eur0(coutTotal), `${dec(coutTotal / brutTotal, 2)} × ton brut cumulé`)}
      ${tuile('Manque à gagner depuis octobre 2025', `${eur0(manque.bas)} à ${eur0(manque.haut)}`, `sur ${moisAvant + moisApres} mois, reconstitution de l'engagement écrit`)}
    </div>

    <div class="card">
      <header>
        <h2>La trajectoire</h2>
        <span class="hint">${f.length} bulletins, trois grandeurs</span>
      </header>
      <div class="trace-boite"><svg class="trace" viewBox="0 0 ${W} ${H}" role="img"
           aria-label="Brut mensuel versé d'octobre 2021 à août 2026, de ${eur0(premier.brut)} à ${eur0(dernier.brut)}">
        ${grilleY}${reperes}
        <path class="courbe net" d="${cheminNet}"></path>
        <path class="courbe" d="${chemin}"></path>
        ${points}
        <text class="etiq reel" x="${(W - R + 10).toFixed(1)}" y="${(gy(dernier.brut) + 4).toFixed(1)}">brut</text>
        <text class="etiq" x="${(W - R + 10).toFixed(1)}" y="${(gy(dernier.net_paye) + 4).toFixed(1)}">net perçu</text>
        ${grilleX}
      </svg></div>
      <div class="sous-titre">Impôt prélevé à la source, échelle propre, en euros</div>
      <div class="trace-boite">
      <svg class="trace" viewBox="0 0 ${W} ${iH}" role="img"
           aria-label="Impôt prélevé à la source chaque mois, de zéro à ${eur0(maxImpot)}">
        ${grilleImpot}
        <path class="courbe impot" d="${cheminImpot}"></path>
        <text class="etiq" x="${(W - R + 10).toFixed(1)}" y="${(gyI(dernier.impot_preleve) + 4).toFixed(1)}">impôt</text>
      </svg></div>
      <div class="legende" style="margin-top:12px">
        <span class="cle trait-brut">brut mensuel</span>
        <span class="cle trait-net">net perçu, après impôt</span>
      </div>
      <p class="hint" style="margin-top:14px">
        <strong>L'impôt a son propre cadre, et c'est voulu.</strong> Il plafonne à ${eur0(maxImpot)} quand
        le brut dépasse ${eur0(maxBrut)}. Sur l'axe du haut il serait collé à la ligne du bas et
        n'apprendrait rien. Deux cadres qui partagent le même axe des temps disent la même chose sans
        écraser l'un des deux, et sans faire croire à une proportion qui n'existe pas.
      </p>
      <p class="hint" style="margin-top:12px">
        ${noteTrous}
        Les pics correspondent à des éléments variables et les creux à des absences, le bulletin ne les
        détaille pas dans les champs extraits, donc rien n'est affirmé sur leur nature.
      </p>
    </div>

    <div class="card">
      <header>
        <h2>Les revalorisations que le dossier peut dater</h2>
        <span class="hint">${revalos.length} sur ${dec((iFin + 1) / 12, 1)} ans</span>
      </header>
      ${revalos
        .map((r) => `
        <div class="revalo">
          <div class="revalo-quand">${esc(r.quand)}</div>
          <div class="revalo-piste"><span class="revalo-barre" style="width:${((r.taux / tauxMax) * 100).toFixed(1)}%"></span></div>
          <div class="revalo-taux ${r.taux >= 10 ? 'fort' : ''}">+${pct(r.taux)}</div>
          <div class="revalo-src faint">${eur2(r.de)} → ${eur2(r.vers)}, ${esc(r.source)}</div>
        </div>`)
        .join('')}
      <p class="hint" style="margin-top:16px">
        <strong>Septembre 2022, plus 10,01 pour cent.</strong> Une hausse à deux chiffres a déjà été
        accordée dans cette entreprise, et sur ce poste. C'est exactement l'ordre de grandeur écrit
        en septembre 2025, ce qui retire à la demande de mardi tout caractère exceptionnel.
      </p>
      <p class="hint" style="margin-top:10px">
        <strong>Et elles ralentissent.</strong> Sur les ${debut.mois} premiers mois, jusqu'à
        ${moisPlein(derniereBase)}, la base contractuelle monte de ${dec(debut.hausse, 1)} %, soit
        ${dec(annuel(debut), 1)} % par an. Sur les ${suite.mois} suivants, jusqu'à mars 2026,
        elle monte de ${dec(suite.hausse, 1)} %, soit ${dec(annuel(suite), 1)} % par an.
        La progression a été divisée par ${dec(annuel(debut) / annuel(suite), 1)}.
        C'est la stagnation que tu as signalée aux RH le 1er septembre, en chiffres.
      </p>
      <p class="hint faint" style="margin-top:10px">
        Entre ${moisPlein(derniereBase)} et septembre 2025, la base passe de ${eur2(derniereBase.base_contractuelle)}
        à ${eur2(septembre)}, soit ${dec((septembre / derniereBase.base_contractuelle - 1) * 100, 2)} % en
        ${indexMois(2025, 9) - indexMois(derniereBase.annee, derniereBase.mois)} mois. Aucune pièce du dossier ne date
        ces hausses, les bulletins de cette période n'impriment plus la base contractuelle et aucun avenant
        correspondant n'est consigné. Elles ne sont donc pas portées ci-dessus.
      </p>
    </div>

    <div class="card">
      <header>
        <h2>Ce que l'engagement de 2025 aurait donné</h2>
        <span class="hint">reconstitution, base contractuelle contre base contractuelle</span>
      </header>
      <div class="trace-boite"><svg class="trace" viewBox="0 0 ${cW} ${cH}" role="img"
           aria-label="Écart entre la base contractuelle versée et l'engagement de 10 à 12 pour cent, d'octobre 2025 à août 2026">
        ${cGrille}
        <path class="aire-manque" d="${aire}"></path>
        <path class="promis" d="${marche(cf.haut.avant, cf.haut.apres)}"></path>
        <path class="promis" d="${marche(cf.bas.avant, cf.bas.apres)}"></path>
        <path class="courbe" d="${marche(base25, base26)}"></path>
        <text class="etiq" x="${(cW - cR + 10).toFixed(1)}" y="${(cy(cf.haut.apres) + 4).toFixed(1)}">12 %, ${eur0(cf.haut.apres)}</text>
        <text class="etiq" x="${(cW - cR + 10).toFixed(1)}" y="${(cy(cf.bas.apres) + 4).toFixed(1)}">10 %, ${eur0(cf.bas.apres)}</text>
        <text class="etiq reel" x="${(cW - cR + 10).toFixed(1)}" y="${(cy(base26) + 4).toFixed(1)}">versé, ${eur0(base26)}</text>
        <text class="axe-x" x="${cx(iOct25).toFixed(1)}" y="${cH - 8}">oct. 2025</text>
        <text class="axe-x" x="${cx(iMars26).toFixed(1)}" y="${cH - 8}">mars 2026</text>
      </svg></div>
      <dl class="kv" style="margin-top:16px">
        <dt>Salaire de septembre 2025</dt><dd>${eur2(septembre)}</dd>
        <dt>Ce qui a été écrit</dt><dd>10 à 12 %, soit ${eur2(cf.bas.avant)} à ${eur2(cf.haut.avant)}</dd>
        <dt>Ce qui a été appliqué</dt><dd>${eur2(base25)} en octobre 2025, puis ${eur2(base26)} en mars 2026</dd>
        <dt>Écart mensuel aujourd'hui</dt><dd><span class="ecart gap">${eur2(cf.bas.apres - base26)} à ${eur2(cf.haut.apres - base26)}</span></dd>
        <dt>Cumul sur ${moisAvant + moisApres} mois</dt><dd><span class="ecart gap">${eur0(manque.bas)} à ${eur0(manque.haut)}</span></dd>
      </dl>
      <p class="hint faint" style="margin-top:14px">
        L'aire colorée est ce cumul. Calculé sur le bulletin de septembre 2025 et sur la synthèse
        d'entretien signée des deux parties, avec les 2 % de mars 2026 appliqués aux deux hypothèses.
        Ce n'est pas une estimation de marché, c'est l'arithmétique d'un engagement écrit.
      </p>
    </div>

    <div class="card">
      <header>
        <h2>Les paliers de classification</h2>
        <span class="hint">largeur proportionnelle à la durée</span>
      </header>
      <div class="frise">${frise}</div>
      <p class="hint" style="margin-top:16px">
        Un seul changement de classification en ${dec((iFin + 1) / 12, 1)} ans, en octobre 2024.
        Depuis, ${indexMois(dernier.annee, dernier.mois) - indexMois(2024, 10) + 1} mois à la même position
        2.2 coefficient 130, pendant que l'intitulé passait de Consultant confirmé à Technical Specialist.
        <strong>Le titre a bougé, la classification non</strong>, et c'est ce que porte le deuxième des quatre
        points à faire acter par écrit mardi, le calendrier de classification.
      </p>
    </div>

    <div class="card">
      <header>
        <h2>Année par année</h2>
        <span class="hint">coût employeur, brut, net perçu, impôt</span>
      </header>
      ${barres}
      <div class="legende">
        <span class="cle cout">coût employeur</span>
        <span class="cle brut">brut</span>
        <span class="cle net">net perçu</span>
        <span class="cle impot">impôt</span>
      </div>
      <p class="hint faint" style="margin-top:14px">
        2021 ne compte que ${parAnnee[0].mois} mois et 2026 s'arrête en août. Les totaux de ces deux années
        ne sont pas comparables aux quatre années pleines.
      </p>
    </div>`;
}

/* --------------------------------------------------------------- rendu */

function rendre() {
  const vues = {
    reste: vueResteAFaire,
    tableau: vueTableau,
    actions: vueActions,
    competences: vueCompetences,
    realisations: vueRealisations,
    engagements: vueEngagements,
    remuneration: vueRemuneration,
    offres: vueOffres,
    entrainement: vueReflexes,
    cible: vueCible,
    notes: vueNotes,
    discussions: vueDiscussions,
    inbox: vueInbox,
  };
  document.getElementById('view').innerHTML = vues[ui.onglet]();
  rendreOnglets();
}

function rendreOnglets() {
  // Neuf entrees a plat se lisent mal, on les groupe avec un intitule discret.
  const groupes = [...new Set(ONGLETS.map((o) => o.groupe))];
  document.getElementById('tabs').innerHTML = groupes
    .map(
      (g) => `<div class="groupe"><span class="groupe-titre">${esc(g)}</span>${ONGLETS.filter((o) => o.groupe === g)
        .map((o) => `<button role="tab" data-onglet="${o.id}" aria-selected="${ui.onglet === o.id}">${o.libelle}</button>`)
        .join('')}</div>`,
    )
    .join('');

  const p = state.profil;
  const poste = renseigne(p.intitule_contractuel) ? p.intitule_contractuel : 'poste à renseigner';
  const classe = p.classification ? `, ${p.classification.position}/${p.classification.coefficient}` : '';
  document.getElementById('topbar-sub').textContent = `${p.nom ?? ''}\n${poste}${classe}`;
}

/* ------------------------------------------------------------ evenements */

// Les notes ne sont lues qu'au moment ou on les ouvre, puis gardees en memoire.
async function ouvrirNote(nom) {
  ui.noteActive = nom;
  if (state.noteContenu[nom] === undefined) {
    rendre();
    try {
      const reponse = await fetch(`/api/notes/${encodeURIComponent(nom)}`);
      state.noteContenu[nom] = reponse.ok ? await reponse.text() : `Lecture impossible (${reponse.status}).`;
    } catch (err) {
      state.noteContenu[nom] = `Lecture impossible, ${err.message}`;
    }
  }
  rendre();
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const bouton = e.target.closest('[data-onglet]');
  if (!bouton) return;
  ui.onglet = bouton.dataset.onglet;
  if (ui.onglet === 'notes' && ui.noteActive && state.noteContenu[ui.noteActive] === undefined) {
    return ouvrirNote(ui.noteActive);
  }
  rendre();
});

document.getElementById('view').addEventListener('click', async (e) => {
  const cible = e.target.closest('[data-role]');
  if (!cible) return;
  const role = cible.dataset.role;

  // On enregistre la reponse puis on rend : le meme rendu revele le motif sous
  // l'option choisie et sous la bonne, sans en dire plus sur les autres.
  if (role === 'ent-choix') {
    const x = ent().exercice;
    if (x.choisi !== null) return;
    const s = state.exercices.situations[x.i];
    const k = Number(cible.dataset.k);
    x.choisi = k;
    x.reponses.push({ id: s.id, titre: s.titre, bon: Boolean(s.options[k].bon), faute: s.options[k].faute ?? null });
    return rendre();
  }

  if (role === 'ent-suivant') {
    Object.assign(ent().exercice, { i: ent().exercice.i + 1, ordre: null, choisi: null });
    return rendre();
  }

  if (role === 'ent-recommencer') {
    Object.assign(ent().exercice, { i: 0, ordre: null, choisi: null, reponses: [], enregistree: false });
    return rendre();
  }

  // On laisse le navigateur ouvrir ou fermer le <details>, on ne fait que memoriser
  // l'etat pour le prochain rendu. Pas de rendre() ici, sinon l'ouverture est annulee.
  if (role === 'champ') {
    const id = cible.closest('[data-champ-id]').dataset.champId;
    const c = state.formulaire.champs.find((x) => x.id === id);
    c.fait = !c.fait;
    await sauver('formulaire');
    return rendre();
  }

  if (role === 'base') {
    ui.baseComparaison = cible.value;
    return rendre();
  }

  if (role === 'offre') {
    const id = cible.dataset.id;
    if (cible.open) ui.offresOuvertes.delete(id);
    else ui.offresOuvertes.add(id);
    return;
  }

  if (role === 'discussion') {
    const id = cible.dataset.id;
    if (cible.open) ui.discussionsOuvertes.delete(id);
    else ui.discussionsOuvertes.add(id);
    return;
  }

  if (role === 'etapes') {
    const id = cible.dataset.id;
    if (cible.open) ui.etapesOuvertes.delete(id);
    else ui.etapesOuvertes.add(id);
    return;
  }

  if (role === 'note') {
    return ouvrirNote(cible.dataset.nom);
  }

  // Copie d'un bloc de texte pret a coller dans l'outil RH.
  if (role === 'copier-bloc') {
    const citation = cible.parentElement.querySelector('blockquote');
    try {
      await navigator.clipboard.writeText(citation.innerText.trim());
      cible.textContent = 'Copié';
      setTimeout(() => { cible.textContent = 'Copier'; }, 1600);
    } catch {
      toast('Copie refusée par le navigateur, sélectionne le texte à la main', 'error');
    }
    return;
  }

  if (role === 'filtre') {
    ui.filtreStatut = cible.dataset.valeur;
    return rendre();
  }

  if (role === 'cible') {
    ui.cibleAffichee = cible.dataset.valeur;
    return rendre();
  }

  if (role === 'activer') {
    state.cible.cible_active = cible.dataset.valeur;
    ui.cibleAffichee = cible.dataset.valeur;
    await sauver('cible');
    return rendre();
  }

  if (role === 'toggle') {
    const id = cible.closest('[data-action-id]').dataset.actionId;
    const action = state.actions.actions.find((a) => a.id === id);
    action.statut = action.statut === 'fait' ? 'a_faire' : 'fait';
    await sauver('actions');
    return rendre();
  }

  if (role === 'semaine') {
    const id = cible.closest('[data-habit-id]').dataset.habitId;
    const habitude = state.actions.habitudes.find((h) => h.id === id);
    const semaine = cible.dataset.semaine;
    habitude.completions ??= [];
    const i = habitude.completions.indexOf(semaine);
    if (i >= 0) habitude.completions.splice(i, 1);
    else habitude.completions.push(semaine);
    habitude.completions.sort();
    await sauver('actions');
    return rendre();
  }

  if (role === 'export') {
    ui.exportVisible = !ui.exportVisible;
    return rendre();
  }

  if (role === 'copier') {
    try {
      await navigator.clipboard.writeText(exporterMarkdown());
      toast('Markdown copié');
    } catch {
      toast('Copie refusée par le navigateur, sélectionne le texte à la main', 'error');
    }
  }
});

document.getElementById('view').addEventListener('change', async (e) => {
  const champ = e.target.closest('[data-role]');
  if (!champ) return;

  if (champ.dataset.role === 'statut') {
    const id = champ.closest('[data-action-id]').dataset.actionId;
    state.actions.actions.find((a) => a.id === id).statut = champ.value;
    await sauver('actions');
    return rendre();
  }

  if (champ.dataset.role === 'niveau') {
    const nom = champ.closest('[data-nom]').dataset.nom;
    const competence = state.competences.competences.find((c) => c.nom === nom);
    competence.niveau_actuel = champ.value === '' ? null : Number(champ.value);
    await sauver('competences');
    return rendre();
  }
});

document.getElementById('view').addEventListener('submit', async (e) => {
  if (e.target.id !== 'form-realisation') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const competences = String(f.get('competences') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  state.realisations.realisations.push({
    date: f.get('date'),
    titre: f.get('titre'),
    contexte: f.get('contexte') || null,
    impact: f.get('impact') || null,
    preuve: f.get('preuve') || null,
    competences_demontrees: competences,
  });
  await sauver('realisations');
  rendre();
});

/* ------------------------------------------------------------- demarrage */

async function demarrer() {
  try {
    const [config, profil, cible, actions, competences, realisations, engagements, offres, formulaire, entrainement, exercices, discussions, paie] =
      await Promise.all(
        ['config', 'profil', 'cible', 'actions', 'competences', 'realisations', 'engagements', 'offres', 'formulaire', 'entrainement', 'exercices', 'discussions', 'paie'].map(
          charger,
        ),
      );
    Object.assign(state, {
      config, profil, cible, actions, competences, realisations, engagements, offres, formulaire, entrainement, exercices, discussions, paie,
    });

    try {
      state.inbox = await (await fetch('/api/inbox')).json();
    } catch {
      // L'inbox est secondaire, son echec ne doit pas empecher le reste de s'afficher.
    }

    try {
      state.notes = await (await fetch('/api/notes')).json();
      // Le document d'entretien d'abord, sinon la note la plus recente.
      const prefere = ['entretien', 'dossier'];
      ui.noteActive =
        (prefere.map((p) => state.notes.find((n) => n.nom.startsWith(p))).find(Boolean) ?? state.notes[0])?.nom ?? null;
    } catch {
      // Idem, les notes sont un confort de lecture.
    }

    ui.cibleAffichee = state.cible.cible_active ?? 'seniorite';
    rendre();
    if (ui.noteActive) ouvrirNote(ui.noteActive);
  } catch (err) {
    document.getElementById('view').innerHTML =
      `<div class="card"><h2>Chargement impossible</h2><p class="hint">${esc(err.message)}</p></div>`;
  }
}

demarrer();
