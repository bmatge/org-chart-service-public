/* ══════════════════════════════════════════════════════════════════
   LIB.JS — Fonctions pures (sans dependance DOM)
   Charge via <script> en browser, require() en Node/tests.
══════════════════════════════════════════════════════════════════ */

/* ── Utils ── */

function esc(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Parsing champs API Service Public ── */

function getChildIds(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.filter(h => h.type_hierarchie === 'Service Fils').map(h => h.service).filter(Boolean);
  } catch (e) { return []; }
}

function parseAdresse(raw) {
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length > 0) {
      const a = arr.find(x => x.type_adresse === 'Adresse') || arr[0];
      const rue = a.numero_voie || '';
      const ville = [a.code_postal, a.nom_commune].filter(Boolean).join(' ');
      return {
        formatted: [rue, ville].filter(Boolean).join(', '),
        commune: a.nom_commune || '',
        cp: a.code_postal || ''
      };
    }
  } catch(e) {}
  return null;
}

function parseResponsable(raw) {
  if (!raw) return null;
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(data) && data.length > 0) {
      const entry = data[0];
      const p = entry.personne || entry;
      const parts = [p.prenom, p.nom].filter(Boolean);
      if (parts.length === 0) return null;
      return { nom: parts.join(' '), role: entry.fonction || p.fonction || p.qualite || '' };
    }
  } catch(e) {}
  return null;
}

function parseTelephone(raw) {
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length > 0) return arr[0].valeur || null;
  } catch(e) {}
  return null;
}

function parseReseauSocial(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map(r => ({
      url: r.valeur || '',
      platform: r.custom_dico2 || r.description || 'Lien'
    })).filter(r => r.url);
  } catch(e) { return []; }
}

/* ── Parsing format GRIST / Modale (plateforme:url par ligne) ── */

function parseGristSocial(raw) {
  if (!raw) return [];
  return String(raw).split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return { platform: 'Lien', url: line };
    return { platform: line.substring(0, idx).trim(), url: line.substring(idx + 1).trim() };
  }).filter(s => s.url);
}

function parseModalSocial(raw) {
  return raw.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return { platform: 'Lien', url: line };
    return { platform: line.substring(0, idx).trim(), url: line.substring(idx + 1).trim() };
  }).filter(s => s.url);
}

/* ── Construction noeud depuis record API ── */

function entityToNode(r, level) {
  const adresse = parseAdresse(r.adresse);
  const resp = parseResponsable(r.affectation_personne);
  const tel = parseTelephone(r.telephone);
  const social = parseReseauSocial(r.reseau_social);
  const childIds = getChildIds(r.hierarchie);

  return {
    id: r.id,
    name: r.nom || 'Sans nom',
    ancienNom: r.ancien_nom || null,
    type: r.type_organisme || '',
    level,
    children: [],
    responsable: resp,
    telephone: tel,
    adresse: adresse,
    formulaireContact: r.formulaire_contact || null,
    siren: r.siren || null,
    reseauSocial: social,
    urlSP: r.url_service_public || '',
    declaredChildCount: childIds.length,
    _record: r
  };
}

/* ── Comptage & aplatissement ── */

function countNodes(n) {
  return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0);
}

function maxTreeDepth(n, d = 0) {
  if (!n.children || n.children.length === 0) return d;
  return Math.max(...n.children.map(c => maxTreeDepth(c, d + 1)));
}

function flattenForD3(node, parentId = null, arr = []) {
  arr.push({
    id: node.id, parentId,
    name: node.name,
    ancienNom: node.ancienNom || '',
    level: node.level,
    responsable: node.responsable ? node.responsable.nom : '',
    role: node.responsable ? node.responsable.role : '',
    telephone: node.telephone || '',
    adresseFormatted: node.adresse ? node.adresse.formatted : '',
    formulaireContact: node.formulaireContact || '',
    siren: node.siren || '',
    reseauSocial: node.reseauSocial || [],
    _childCount: (node.children || []).length,
    declaredChildCount: node.declaredChildCount || 0
  });
  (node.children || []).forEach(c => flattenForD3(c, node.id, arr));
  return arr;
}

function flattenForCSV(node, arr = []) {
  arr.push({
    id: node.id, nom: node.name, type: node.type, niveau: node.level,
    responsable: node.responsable?.nom || '', fonction: node.responsable?.role || '',
    telephone: node.telephone || '',
    adresse: node.adresse ? node.adresse.formatted : '',
    formulaire_contact: node.formulaireContact || '',
    siren: node.siren || '',
    reseaux_sociaux: (node.reseauSocial || []).map(s => s.platform + ':' + s.url).join(' | '),
  });
  (node.children || []).forEach(c => flattenForCSV(c, arr));
  return arr;
}

/* ── Recherche / manipulation arbre ── */

function findNode(node, id) {
  if (node.id === id) return node;
  for (const c of (node.children || [])) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

function detachNode(root, id) {
  const stack = [root];
  while (stack.length) {
    const parent = stack.pop();
    const idx = (parent.children || []).findIndex(c => c.id === id);
    if (idx !== -1) return parent.children.splice(idx, 1)[0];
    stack.push(...(parent.children || []));
  }
  return null;
}

/* ── Construction arbre GRIST ── */

function gristRecordsToTree(records) {
  const map = new Map();

  for (const r of records) {
    map.set(r.id, {
      id: String(r.id),
      name: r.name || 'Sans nom',
      ancienNom: r.ancienNom || null,
      type: '',
      level: 0,
      children: [],
      responsable: r.responsableNom ? { nom: r.responsableNom, role: r.responsableRole || '' } : null,
      telephone: r.telephone || null,
      adresse: r.adresse ? { formatted: String(r.adresse), commune: '', cp: '' } : null,
      formulaireContact: r.contact || null,
      siren: r.siren ? String(r.siren) : null,
      reseauSocial: parseGristSocial(r.reseaux),
      urlSP: '',
      declaredChildCount: 0,
      _record: null,
      _gristId: r.id
    });
  }

  let root = null;
  for (const r of records) {
    const node = map.get(r.id);
    const pid = r.parentId;
    if (!pid || pid === 0) {
      if (!root) root = node;
    } else if (map.has(pid)) {
      map.get(pid).children.push(node);
    }
  }

  function setLevels(n, lvl) {
    n.level = lvl;
    n.declaredChildCount = n.children.length;
    n.children.forEach(c => setLevels(c, lvl + 1));
  }
  if (root) setLevels(root, 0);

  return root;
}

/* ── Sauvegarde ── */

function cleanTreeForSave(node) {
  return JSON.parse(JSON.stringify(node, (k, v) => k === '_record' ? undefined : v));
}

/* ── Export Node/tests ── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, getChildIds, parseAdresse, parseResponsable, parseTelephone,
    parseReseauSocial, parseGristSocial, parseModalSocial,
    entityToNode, countNodes, maxTreeDepth, flattenForD3, flattenForCSV,
    findNode, detachNode, gristRecordsToTree, cleanTreeForSave
  };
}
