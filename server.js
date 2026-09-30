// Cockpit de carriere - serveur local minimal.
// Modules natifs uniquement, aucune dependance. Ecoute sur 127.0.0.1 seulement :
// ces donnees sont personnelles, elles n'ont rien a faire sur le reseau.

import { createServer } from 'node:http';
import { readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const INBOX = path.join(ROOT, 'inbox');
const NOTES = path.join(ROOT, 'notes');
const PORT = Number(process.env.PORT) || 4173;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Le nom de dataset arrive de l'URL et sert a construire un chemin de fichier :
// sans cette validation, "../../.." laisse lire et ecrire n'importe ou sur le disque.
const SAFE_NAME = /^[a-z][a-z-]{0,39}$/;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value, null, 2));
}

async function readBody(req, limitBytes = 5_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('corps de requete trop volumineux');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function listDir(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (name.startsWith('.') || name === 'traites' || name === 'README.md') continue;
    try {
      const info = await stat(path.join(dir, name));
      if (info.isFile()) {
        out.push({ nom: name, taille: info.size, modifie: info.mtime.toISOString() });
      }
    } catch {
      // fichier disparu entre le listing et le stat : on l'ignore
    }
  }
  return out.sort((a, b) => b.modifie.localeCompare(a.modifie));
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/inbox' && req.method === 'GET') {
    const [enAttente, traites] = await Promise.all([
      listDir(INBOX),
      listDir(path.join(INBOX, 'traites')),
    ]);
    return sendJson(res, 200, { enAttente, traites });
  }

  // Les notes markdown, listees puis servies brutes. Le rendu se fait cote client.
  if (url.pathname === '/api/notes' && req.method === 'GET') {
    const fichiers = (await listDir(NOTES)).filter((f) => f.nom.endsWith('.md'));
    return sendJson(res, 200, fichiers);
  }

  const note = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
  if (note && req.method === 'GET') {
    const nom = decodeURIComponent(note[1]);
    // Meme precaution que pour les jeux de donnees, le nom sert a batir un chemin.
    if (!/^[a-z0-9][a-z0-9-]{0,63}\.md$/.test(nom)) {
      return sendJson(res, 400, { erreur: 'nom de note invalide' });
    }
    try {
      return send(res, 200, await readFile(path.join(NOTES, nom), 'utf8'), 'text/markdown; charset=utf-8');
    } catch {
      return sendJson(res, 404, { erreur: `notes/${nom} introuvable` });
    }
  }

  const match = url.pathname.match(/^\/api\/data\/([^/]+)$/);
  if (!match) return sendJson(res, 404, { erreur: 'route inconnue' });

  const name = decodeURIComponent(match[1]);
  if (!SAFE_NAME.test(name)) {
    return sendJson(res, 400, { erreur: 'nom de jeu de donnees invalide' });
  }
  const file = path.join(DATA, `${name}.json`);

  if (req.method === 'GET') {
    try {
      return send(res, 200, await readFile(file, 'utf8'));
    } catch {
      return sendJson(res, 404, { erreur: `data/${name}.json introuvable` });
    }
  }

  if (req.method === 'PUT') {
    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, 400, { erreur: `JSON invalide : ${err.message}` });
    }
    // Ecriture atomique : si le process meurt en cours d'ecriture, le fichier
    // d'origine reste intact plutot que d'etre tronque.
    //
    // Le nom du temporaire est UNIQUE par ecriture. Avec un nom fixe, deux PUT
    // rapproches sur le meme jeu de donnees ecrivaient dans le meme fichier et le
    // resultat etait un JSON corrompu. Constate le 24/09/2026 en enregistrant deux
    // series d'exercice a la suite. Le rename reste atomique, le dernier ecrivain
    // gagne, ce qui est le comportement attendu.
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { erreur: 'methode non autorisee' });
}

// La fiche d'entretien vit hors de public/, et handleStatic refuse par
// construction tout ce qui en sort. Un lien file:// est bloque par le navigateur
// depuis une page http://, d'ou cette route. Le chemin est ecrit en dur, sans
// parametre : sans nom venant de l'URL, il n'y a pas de traversee a valider.
async function handleFiche(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { erreur: 'methode non autorisee' });
  try {
    const html = await readFile(path.join(ROOT, 'fiche', 'fiche-entretien.html'), 'utf8');
    return send(res, 200, html, 'text/html; charset=utf-8');
  } catch {
    return send(res, 404, 'fiche introuvable', 'text/plain; charset=utf-8');
  }
}

async function handleStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(PUBLIC, rel);
  // path.join resout deja les ".." : on verifie que le resultat reste sous public/.
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    return send(res, 400, 'requete invalide', 'text/plain; charset=utf-8');
  }
  try {
    const body = await readFile(file);
    return send(res, 200, body, MIME[path.extname(file)] ?? 'application/octet-stream');
  } catch {
    return send(res, 404, 'introuvable', 'text/plain; charset=utf-8');
  }
}

const server = createServer(async (req, res) => {
  // La construction de l'URL est HORS du try, et elle peut lever : "//" est une
  // URL relative au protocole, donc sans hote, et new URL la refuse. Une seule
  // requete de ce genre suffisait a tuer le serveur. On la traite comme une
  // requete invalide plutot que comme une erreur fatale.
  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    return send(res, 400, 'requete invalide', 'text/plain; charset=utf-8');
  }

  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (url.pathname === '/fiche') await handleFiche(req, res);
    else await handleStatic(req, res, url);
  } catch (err) {
    console.error(`[erreur] ${req.method} ${url.pathname} :`, err.message);
    if (!res.headersSent) sendJson(res, 500, { erreur: err.message });
  }
});

// Une erreur de socket ne doit pas non plus emporter le processus.
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, () => {
  console.log(`Cockpit de carriere : http://${HOST}:${PORT}`);
  console.log('Ctrl+C pour arreter.');
});
