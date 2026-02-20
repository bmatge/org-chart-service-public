/* ══════════════════════════════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════════════════════════════ */
const API = 'https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records';

const ALL_FIELDS = [
  'nom','ancien_nom','type_organisme','categorie',
  'id','url_service_public','telephone',
  'affectation_personne','hierarchie','adresse',
  'formulaire_contact','reseau_social','siren'
].join(',');

const CATEGORIES = ['SI','NA','RG','DP','SL'];

const GRIST_RENAME = 'Nom:name|Parent:parentId|AncienNom:ancienNom|Responsable:responsableNom|Fonction:responsableRole|Telephone:telephone|Adresse:adresse|Contact:contact|Siren:siren|Reseaux:reseaux';

/* ══════════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════════ */
let selectedEntity = null;
let currentHierarchy = null;
let d3c = null;
let acAbort = null;
let selectedNodeId = null;

/* ══════════════════════════════════════════════════════════════════
   SOURCE DE DONNÉES (toggle API SP / GRIST)
══════════════════════════════════════════════════════════════════ */
function toggleDataSource() {
  const isGrist = document.getElementById('data-source').value === 'grist';
  document.getElementById('sp-search').style.display = isGrist ? 'none' : '';
  document.getElementById('sp-categories').style.display = isGrist ? 'none' : '';
  document.getElementById('selected-wrap').style.display = 'none';
  document.getElementById('grist-config').style.display = isGrist ? '' : 'none';
  // Hide depth slider (API-SP only: tree is fetched level by level)
  document.getElementById('depth').closest('.fr-input-group').style.display = isGrist ? 'none' : '';
}

// Show/hide custom URL field when "Autre" is selected
document.getElementById('grist-server').addEventListener('change', function() {
  document.getElementById('grist-custom-url-group').style.display =
    this.value === 'custom' ? '' : 'none';
});

function getGristBaseUrl() {
  const sel = document.getElementById('grist-server').value;
  if (sel === 'custom') {
    return document.getElementById('grist-custom-url').value.trim().replace(/\/+$/, '');
  }
  return sel;
}

/* Maps known GRIST hosts to Charts Builder proxy paths */
const GRIST_PROXIES = {
  'grist.numerique.gouv.fr': 'https://chartsbuilder.matge.com/grist-gouv-proxy',
  'docs.getgrist.com': 'https://chartsbuilder.matge.com/grist-proxy'
};

async function gristApiFetch(path) {
  const baseUrl = getGristBaseUrl();
  const apiKey = document.getElementById('grist-key').value.trim();
  if (!baseUrl) throw new Error('Renseignez le serveur GRIST.');
  if (!apiKey) throw new Error('Renseignez la clé API.');

  const host = new URL(baseUrl).hostname;
  const proxyBase = GRIST_PROXIES[host];
  const url = proxyBase ? proxyBase + path : baseUrl + path;

  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + apiKey }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  return res.json();
}

async function loadGristTables() {
  const docId = document.getElementById('grist-doc').value.trim();
  if (!docId) { alert('Renseignez l\'ID du document.'); return; }

  const btn = document.getElementById('grist-tables-btn');
  btn.disabled = true;
  btn.textContent = 'Chargement…';

  try {
    const json = await gristApiFetch('/api/docs/' + encodeURIComponent(docId) + '/tables');
    const tables = json.tables || [];
    if (tables.length === 0) throw new Error('Aucune table trouvée dans ce document.');

    const select = document.getElementById('grist-table');
    select.innerHTML = '<option value="">— Sélectionnez une table —</option>' +
      tables.map(t => `<option value="${esc(t.id)}">${esc(t.id)}</option>`).join('');

    document.getElementById('grist-table-group').style.display = '';
  } catch (err) {
    alert('Erreur : ' + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Charger les tables';
  }
}

/* ══════════════════════════════════════════════════════════════════
   OPTIONS
══════════════════════════════════════════════════════════════════ */
function getOpts() {
  return {
    resp:    document.getElementById('show-resp').checked,
    tel:     document.getElementById('show-tel').checked,
    addr:    document.getElementById('show-addr').checked,
    contact: document.getElementById('show-contact').checked,
    siren:   document.getElementById('show-siren').checked,
    social:  document.getElementById('show-social').checked,
  };
}

function getSelectedCategories() {
  const cats = CATEGORIES.filter(c => document.getElementById('cat-' + c).checked);
  return cats.length > 0 ? cats : ['SI'];
}

function buildCatWhere() {
  const cats = getSelectedCategories();
  if (cats.length === 1) return `categorie:"${cats[0]}"`;
  return '(' + cats.map(c => `categorie:"${c}"`).join(' OR ') + ')';
}

/* ══════════════════════════════════════════════════════════════════
   AUTOCOMPLETE
══════════════════════════════════════════════════════════════════ */
const searchInput = document.getElementById('search-input');
const acDropdown = document.getElementById('ac-dropdown');
let acTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(acTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) { acDropdown.style.display = 'none'; return; }
  acTimer = setTimeout(() => fetchSuggestions(q), 300);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') acDropdown.style.display = 'none';
});

document.addEventListener('click', e => {
  if (!e.target.closest('.ac-wrap')) acDropdown.style.display = 'none';
});

async function fetchSuggestions(query) {
  if (acAbort) acAbort.abort();
  acAbort = new AbortController();

  acDropdown.innerHTML = '<div class="ac-loading">Recherche…</div>';
  acDropdown.style.display = 'block';

  try {
    const where = `${buildCatWhere()} AND suggest(nom,"${query}")`;
    const url = `${API}?where=${encodeURIComponent(where)}&limit=10&select=${encodeURIComponent('nom,id,type_organisme,hierarchie')}`;
    const res = await fetch(url, { signal: acAbort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const results = json.results || [];

    if (results.length === 0) {
      acDropdown.innerHTML = '<div class="ac-empty">Aucun résultat</div>';
      return;
    }

    acDropdown.innerHTML = results.map(r => {
      const childCount = getChildIds(r.hierarchie).length;
      const childLabel = childCount > 0 ? `${childCount} sous-entité${childCount > 1 ? 's' : ''}` : 'aucune sous-entité';
      return `<div class="ac-item" data-id="${esc(r.id)}" data-nom="${esc(r.nom)}" data-type="${esc(r.type_organisme || '')}">
        <div class="ac-name">${esc(r.nom)}</div>
        <div class="ac-type">${esc(r.type_organisme || '')}</div>
        <div class="ac-children">${childLabel}</div>
      </div>`;
    }).join('');

    acDropdown.querySelectorAll('.ac-item').forEach(item => {
      item.addEventListener('click', () => {
        selectEntity(item.dataset.id, item.dataset.nom, item.dataset.type);
        acDropdown.style.display = 'none';
      });
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    acDropdown.innerHTML = `<div class="ac-empty">Erreur : ${esc(err.message)}</div>`;
  }
}

function selectEntity(id, nom, type) {
  selectedEntity = { id, nom, type };
  searchInput.value = '';
  document.getElementById('sel-name').textContent = nom;
  document.getElementById('sel-type').textContent = type || '';
  document.getElementById('selected-wrap').style.display = 'block';
}

function clearSelection() {
  selectedEntity = null;
  document.getElementById('selected-wrap').style.display = 'none';
  searchInput.focus();
}

/* ══════════════════════════════════════════════════════════════════
   PARSING CHAMPS API
══════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════
   CONSTRUCTION DE L'ARBRE (BFS)
══════════════════════════════════════════════════════════════════ */

async function buildTree(rootId, maxDepth, loaderMsg) {
  loaderMsg.textContent = 'Chargement de l\'entité racine…';
  const rootEntity = await fetchEntityById(rootId);
  if (!rootEntity) throw new Error('Entité racine introuvable.');

  const rootNode = entityToNode(rootEntity, 0);
  let currentLevel = [{ node: rootNode, entity: rootEntity }];
  let totalFetched = 1;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const allChildIds = [];
    const parentMap = new Map();

    for (const { node, entity } of currentLevel) {
      for (const cid of getChildIds(entity.hierarchie)) {
        allChildIds.push(cid);
        parentMap.set(cid, node);
      }
    }
    if (allChildIds.length === 0) break;

    loaderMsg.textContent = `Niveau ${depth} : ${allChildIds.length} entité${allChildIds.length > 1 ? 's' : ''}…`;
    const children = await fetchEntitiesByIds(allChildIds);
    totalFetched += children.length;

    const nextLevel = [];
    for (const child of children) {
      const childNode = entityToNode(child, depth);
      const parentNode = parentMap.get(child.id);
      if (parentNode) parentNode.children.push(childNode);
      nextLevel.push({ node: childNode, entity: child });
    }
    currentLevel = nextLevel;
  }

  return { tree: rootNode, totalFetched };
}

async function fetchEntityById(id) {
  const url = `${API}?where=${encodeURIComponent(`id="${id}"`)}&limit=1&select=${encodeURIComponent(ALL_FIELDS)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.results || [])[0] || null;
}

async function fetchEntitiesByIds(ids) {
  if (ids.length === 0) return [];
  const results = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const where = batch.map(id => `id="${id}"`).join(' OR ');
    const url = `${API}?where=${encodeURIComponent(where)}&limit=${batch.length}&select=${encodeURIComponent(ALL_FIELDS)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    results.push(...(json.results || []));
  }
  return results;
}

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

/* ══════════════════════════════════════════════════════════════════
   COMPTAGE & APLATISSEMENT
══════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════
   RENDU HTML (fr-card)
══════════════════════════════════════════════════════════════════ */

function renderSimple(hierarchy) {
  const wrap = document.getElementById('chart-wrap');
  wrap.innerHTML = '';
  const tree = document.createElement('div');
  tree.className = 'orga-tree';
  tree.appendChild(renderNode(hierarchy));
  wrap.appendChild(tree);
}

function renderNode(node) {
  const el = document.createElement('div');
  el.className = 'org-node';
  el.appendChild(makeCard(node));

  if (node.children && node.children.length > 0) {
    el.appendChild(Object.assign(document.createElement('div'), { className: 'node-vline' }));
    const row = document.createElement('div');
    row.className = 'org-children-row';
    node.children.forEach(child => {
      const w = document.createElement('div');
      w.style.cssText = 'display:flex;flex-direction:column;align-items:center';
      w.appendChild(Object.assign(document.createElement('div'), { className: 'node-vline' }));
      w.appendChild(renderNode(child));
      row.appendChild(w);
    });
    el.appendChild(row);
  }
  return el;
}

function makeCard(node) {
  const o = getOpts();
  const isRoot = node.level === 0;
  const card = document.createElement('div');
  card.className = 'orgc-card' + (isRoot ? ' orgc-card--root' : '');
  card.dataset.depth = Math.min(node.level, 4);

  let html = `<div class="orgc-card__title">${esc(node.name)}</div>`;

  if (node.ancienNom && node.ancienNom !== node.name) {
    html += `<div class="orgc-card__ancien">ex : ${esc(node.ancienNom)}</div>`;
  }

  // Detail section
  const details = [];
  if (o.resp && node.responsable) {
    let r = `<div class="orgc-card__row"><span class="orgc-card__row-label">Resp.</span> ${esc(node.responsable.nom)}</div>`;
    if (node.responsable.role) r += `<div class="orgc-card__role">${esc(node.responsable.role)}</div>`;
    details.push(r);
  }
  if (o.tel && node.telephone) {
    details.push(`<div class="orgc-card__row"><span class="orgc-card__row-label">Tél.</span> ${esc(node.telephone)}</div>`);
  }
  if (o.addr && node.adresse && node.adresse.formatted) {
    details.push(`<div class="orgc-card__row"><span class="orgc-card__row-label">Adr.</span> ${esc(node.adresse.formatted)}</div>`);
  }
  if (o.contact && node.formulaireContact) {
    details.push(`<div class="orgc-card__row"><span class="orgc-card__row-label">Contact</span> <a href="${esc(node.formulaireContact)}" target="_blank" rel="noopener" style="color:inherit;font-size:inherit">Formulaire</a></div>`);
  }
  if (o.siren && node.siren) {
    details.push(`<div class="orgc-card__row"><span class="orgc-card__row-label">SIREN</span> ${esc(node.siren)}</div>`);
  }
  if (o.social && node.reseauSocial && node.reseauSocial.length > 0) {
    const links = node.reseauSocial.map(s =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.platform)}</a>`
    ).join('');
    details.push(`<div class="orgc-card__row"><span class="orgc-card__row-label">Social</span></div><div class="orgc-card__social">${links}</div>`);
  }

  if (details.length > 0) {
    html += `<div class="orgc-card__detail">${details.join('')}</div>`;
  }

  // Footer
  const loaded = (node.children || []).length;
  const declared = node.declaredChildCount || 0;
  if (loaded > 0) {
    html += `<div class="orgc-card__footer"><span class="orgc-card__badge">${loaded} sous-entité${loaded > 1 ? 's' : ''}</span></div>`;
  } else if (declared > 0) {
    html += `<div class="orgc-card__footer"><span class="orgc-card__badge orgc-card__badge--muted">${declared} non chargée${declared > 1 ? 's' : ''}</span></div>`;
  }

  card.innerHTML = html;
  card.addEventListener('mouseenter', e => showTT(e, node));
  card.addEventListener('mouseleave', hideTT);
  return card;
}

/* ══════════════════════════════════════════════════════════════════
   RENDU D3
══════════════════════════════════════════════════════════════════ */
function renderD3(flatData) {
  const wrap = document.getElementById('chart-wrap');
  wrap.innerHTML = '<div id="d3-wrap" style="width:100%;height:100%;min-height:500px"></div>';
  d3c = null;
  const o = getOpts();

  const layoutMode = document.getElementById('layout-mode').value;
  const layoutDir = layoutMode === 'column'
    ? 'left'
    : document.getElementById('layout-dir').value;
  const isCompact = layoutMode === 'compact';

  d3c = new d3.OrgChart()
    .container('#d3-wrap')
    .data(flatData)
    .nodeId(d => d.id)
    .parentNodeId(d => d.parentId)
    .layout(layoutDir)
    .compact(isCompact)
    .nodeWidth(() => 260)
    .nodeHeight(d => {
      const nd = d.data;
      // Base: padding (10+10) + title up to 2 lines (~36) + safety
      let h = 60;
      if (nd.ancienNom) h += 18;
      let hasDetail = false;
      if (o.resp && nd.responsable) { hasDetail = true; h += 20; if (nd.role) h += 16; }
      if (o.tel && nd.telephone) { hasDetail = true; h += 20; }
      if (o.addr && nd.adresseFormatted) { hasDetail = true; h += 20; }
      if (o.contact && nd.formulaireContact) { hasDetail = true; h += 20; }
      if (o.siren && nd.siren) { hasDetail = true; h += 20; }
      if (o.social && nd.reseauSocial.length > 0) { hasDetail = true; h += 26; }
      if (hasDetail) h += 14; // detail section top border + margin
      if (nd._childCount > 0 || nd.declaredChildCount > 0) h += 30;
      return h;
    })
    .childrenMargin(() => 44)
    .compactMarginBetween(() => 14)
    .compactMarginPair(() => 80)
    .nodeContent(d => {
      const nd = d.data;
      const isRoot = nd.level === 0;
      const bg    = isRoot ? '#000091' : '#fff';
      const t1    = isRoot ? '#fff' : '#161616';
      const t2    = isRoot ? 'rgba(255,255,255,.6)' : '#929292';
      const t3    = isRoot ? 'rgba(255,255,255,.85)' : '#3a3a3a';
      const sep   = isRoot ? 'rgba(255,255,255,.15)' : '#e5e5e5';
      const bdrL  = isRoot ? 'rgba(255,255,255,.3)' : nd.level <= 1 ? '#000091' : nd.level === 2 ? '#5b5bff' : '#8888dd';
      const badBg = isRoot ? 'rgba(255,255,255,.15)' : '#e3e3fd';
      const badC  = isRoot ? 'rgba(255,255,255,.8)' : '#000091';
      const shadow = isRoot ? 'none' : '0 2px 6px 0 rgba(0,0,18,.16)';
      const lbl = `font-size:9px;font-weight:600;color:${t2};text-transform:uppercase;letter-spacing:.04em;display:inline-block;min-width:40px`;

      const name = nd.name.length > 65 ? nd.name.substring(0, 62) + '…' : nd.name;
      let ancien = nd.ancienNom ? `<div style="font-size:10px;color:${t2};font-style:italic;margin-top:2px">ex : ${esc(nd.ancienNom.substring(0, 40))}${nd.ancienNom.length > 40 ? '…' : ''}</div>` : '';

      // Details
      const rows = [];
      if (o.resp && nd.responsable) {
        rows.push(`<div style="font-size:11px;color:${t3}"><span style="${lbl}">Resp.</span> ${esc(nd.responsable)}</div>`);
        if (nd.role) rows.push(`<div style="font-size:10px;color:${t2};padding-left:44px">${esc(nd.role)}</div>`);
      }
      if (o.tel && nd.telephone) {
        rows.push(`<div style="font-size:11px;color:${t3}"><span style="${lbl}">Tél.</span> ${esc(nd.telephone)}</div>`);
      }
      if (o.addr && nd.adresseFormatted) {
        const addr = nd.adresseFormatted.length > 45 ? nd.adresseFormatted.substring(0, 42) + '…' : nd.adresseFormatted;
        rows.push(`<div style="font-size:11px;color:${t3}"><span style="${lbl}">Adr.</span> ${esc(addr)}</div>`);
      }
      if (o.contact && nd.formulaireContact) {
        rows.push(`<div style="font-size:11px;color:${t3}"><span style="${lbl}">Contact</span> <a href="${esc(nd.formulaireContact)}" target="_blank" onclick="event.stopPropagation()" style="color:${isRoot ? 'rgba(255,255,255,.9)' : '#000091'};text-decoration:underline;font-size:11px">Formulaire</a></div>`);
      }
      if (o.siren && nd.siren) {
        rows.push(`<div style="font-size:11px;color:${t3}"><span style="${lbl}">SIREN</span> ${esc(nd.siren)}</div>`);
      }
      if (o.social && nd.reseauSocial.length > 0) {
        const links = nd.reseauSocial.map(s =>
          `<a href="${esc(s.url)}" target="_blank" onclick="event.stopPropagation()" style="font-size:9px;padding:1px 5px;border-radius:3px;background:${isRoot ? 'rgba(255,255,255,.15)' : '#f0f0f0'};color:${t3};text-decoration:none;display:inline-block">${esc(s.platform)}</a>`
        ).join(' ');
        rows.push(`<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:1px">${links}</div>`);
      }

      let detail = '';
      if (rows.length > 0) {
        detail = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${sep};display:flex;flex-direction:column;gap:2px">${rows.join('')}</div>`;
      }

      // Footer
      let footer = '';
      const loaded = nd._childCount;
      const declared = nd.declaredChildCount;
      if (loaded > 0) {
        footer = `<div style="margin-top:6px;padding-top:4px;border-top:1px solid ${sep}"><span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:${badBg};color:${badC}">${loaded} sous-entité${loaded > 1 ? 's' : ''}</span></div>`;
      } else if (declared > 0) {
        footer = `<div style="margin-top:6px;padding-top:4px;border-top:1px solid ${sep}"><span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${isRoot ? 'rgba(255,255,255,.1)' : '#f0f0f0'};color:${t2};font-style:italic">${declared} non chargée${declared > 1 ? 's' : ''}</span></div>`;
      }

      return `<div style="background:${bg};border-left:4px solid ${bdrL};box-shadow:${shadow};padding:10px 14px;width:${d.width}px;min-height:${d.height}px;font-family:'Marianne',Arial,sans-serif;text-align:left">
        <div style="font-size:12px;font-weight:700;color:${t1};line-height:1.3">${esc(name)}</div>
        ${ancien}${detail}${footer}
      </div>`;
    })
    .onNodeClick(d => selectNodeInChart(d.data.id))
    .render();

  document.getElementById('d3-actions').style.display = 'flex';
}

/* ── Helpers for tree traversal ── */
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

/* ══════════════════════════════════════════════════════════════════
   SÉLECTION / AJOUT / SUPPRESSION DE NOEUDS
══════════════════════════════════════════════════════════════════ */
function selectNodeInChart(id) {
  selectedNodeId = id;
  const bar = document.getElementById('node-actions');
  if (bar) bar.style.display = 'flex';
  const label = document.getElementById('sel-node-label');
  if (label) {
    const node = currentHierarchy ? findNode(currentHierarchy, id) : null;
    label.textContent = node ? node.name : id;
  }
  try { if (d3c) d3c.setHighlighted(id).render(); } catch(e) { /* v3 compat */ }
}

function clearNodeSelection() {
  selectedNodeId = null;
  const bar = document.getElementById('node-actions');
  if (bar) bar.style.display = 'none';
  try { if (d3c) d3c.clearHighlighting(); } catch(e) { /* v3 compat */ }
}

/* ── Modale noeud ── */
let nodeModalMode = null; // 'add' | 'edit'

function openNodeModal(mode) {
  nodeModalMode = mode;
  const modal = document.getElementById('node-modal');
  const title = document.getElementById('node-modal-title');

  // Reset fields
  document.getElementById('nm-name').value = '';
  document.getElementById('nm-ancien').value = '';
  document.getElementById('nm-resp').value = '';
  document.getElementById('nm-role').value = '';
  document.getElementById('nm-tel').value = '';
  document.getElementById('nm-addr').value = '';
  document.getElementById('nm-contact').value = '';
  document.getElementById('nm-siren').value = '';
  document.getElementById('nm-social').value = '';

  if (mode === 'edit') {
    title.textContent = 'Editer le noeud';
    const node = currentHierarchy ? findNode(currentHierarchy, selectedNodeId) : null;
    if (node) {
      document.getElementById('nm-name').value = node.name || '';
      document.getElementById('nm-ancien').value = node.ancienNom || '';
      document.getElementById('nm-resp').value = node.responsable ? node.responsable.nom : '';
      document.getElementById('nm-role').value = node.responsable ? node.responsable.role : '';
      document.getElementById('nm-tel').value = node.telephone || '';
      document.getElementById('nm-addr').value = node.adresse ? node.adresse.formatted : '';
      document.getElementById('nm-contact').value = node.formulaireContact || '';
      document.getElementById('nm-siren').value = node.siren || '';
      document.getElementById('nm-social').value = (node.reseauSocial || [])
        .map(s => s.platform + ':' + s.url).join('\n');
    }
  } else {
    title.textContent = 'Ajouter un noeud enfant';
  }

  modal.style.display = 'flex';
  document.getElementById('nm-name').focus();
}

function closeNodeModal() {
  document.getElementById('node-modal').style.display = 'none';
  nodeModalMode = null;
}

function parseModalSocial(raw) {
  return raw.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return { platform: 'Lien', url: line };
    return { platform: line.substring(0, idx).trim(), url: line.substring(idx + 1).trim() };
  }).filter(s => s.url);
}

function submitNodeModal() {
  const name = document.getElementById('nm-name').value.trim();
  if (!name) { document.getElementById('nm-name').focus(); return; }

  const resp = document.getElementById('nm-resp').value.trim();
  const role = document.getElementById('nm-role').value.trim();
  const tel = document.getElementById('nm-tel').value.trim();
  const addr = document.getElementById('nm-addr').value.trim();
  const contact = document.getElementById('nm-contact').value.trim();
  const siren = document.getElementById('nm-siren').value.trim();
  const ancien = document.getElementById('nm-ancien').value.trim();
  const social = parseModalSocial(document.getElementById('nm-social').value);

  if (nodeModalMode === 'add') {
    if (!selectedNodeId || !d3c) { closeNodeModal(); return; }

    const newId = 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const parentNode = currentHierarchy ? findNode(currentHierarchy, selectedNodeId) : null;
    const parentLevel = parentNode ? parentNode.level : 0;

    d3c.addNode({
      id: newId, parentId: selectedNodeId,
      name, ancienNom: ancien, level: parentLevel + 1,
      responsable: resp, role,
      telephone: tel, adresseFormatted: addr,
      formulaireContact: contact, siren,
      reseauSocial: social,
      _childCount: 0, declaredChildCount: 0
    });

    if (parentNode) {
      parentNode.children.push({
        id: newId, name, ancienNom: ancien || null, type: '',
        level: parentLevel + 1, children: [],
        responsable: resp ? { nom: resp, role } : null,
        telephone: tel || null,
        adresse: addr ? { formatted: addr, commune: '', cp: '' } : null,
        formulaireContact: contact || null,
        siren: siren || null,
        reseauSocial: social, urlSP: '',
        declaredChildCount: 0, _record: null
      });
    }

  } else if (nodeModalMode === 'edit') {
    if (!selectedNodeId || !currentHierarchy) { closeNodeModal(); return; }

    // Update tree node
    const treeNode = findNode(currentHierarchy, selectedNodeId);
    if (treeNode) {
      treeNode.name = name;
      treeNode.ancienNom = ancien || null;
      treeNode.responsable = resp ? { nom: resp, role } : null;
      treeNode.telephone = tel || null;
      treeNode.adresse = addr ? { formatted: addr, commune: '', cp: '' } : null;
      treeNode.formulaireContact = contact || null;
      treeNode.siren = siren || null;
      treeNode.reseauSocial = social;
    }

    // Update D3 flat data
    if (d3c) {
      const state = d3c.getChartState();
      const flatNode = (state.allNodes || []).find(n => n.data.id === selectedNodeId);
      if (flatNode) {
        const fd = flatNode.data;
        fd.name = name;
        fd.ancienNom = ancien;
        fd.responsable = resp;
        fd.role = role;
        fd.telephone = tel;
        fd.adresseFormatted = addr;
        fd.formulaireContact = contact;
        fd.siren = siren;
        fd.reseauSocial = social;
      }
      d3c.render();
    }

    // Update selection label
    const label = document.getElementById('sel-node-label');
    if (label) label.textContent = name;
  }

  closeNodeModal();
}

function addChildNode() {
  if (!selectedNodeId || !d3c) return;
  openNodeModal('add');
}

function editSelectedNode() {
  if (!selectedNodeId || !currentHierarchy) return;
  openNodeModal('edit');
}

function deleteSelectedNode() {
  if (!selectedNodeId || !d3c || !currentHierarchy) return;
  if (selectedNodeId === currentHierarchy.id) {
    alert('Impossible de supprimer la racine.');
    return;
  }

  const node = findNode(currentHierarchy, selectedNodeId);
  const childCount = node ? (node.children || []).length : 0;
  const msg = childCount > 0
    ? `Supprimer « ${node.name} » et ses ${childCount} enfant${childCount > 1 ? 's' : ''} ?`
    : `Supprimer « ${node.name} » ?`;
  if (!confirm(msg)) return;

  d3c.removeNode(selectedNodeId);
  detachNode(currentHierarchy, selectedNodeId);
  clearNodeSelection();
}

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('node-modal').style.display !== 'none') {
    closeNodeModal();
  }
});

/* ══════════════════════════════════════════════════════════════════
   GÉNÉRATION GRIST
══════════════════════════════════════════════════════════════════ */

function parseGristSocial(raw) {
  if (!raw) return [];
  return String(raw).split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return { platform: 'Lien', url: line };
    return { platform: line.substring(0, idx).trim(), url: line.substring(idx + 1).trim() };
  }).filter(s => s.url);
}

function gristRecordsToTree(records) {
  const map = new Map();

  // Create nodes
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

  // Build tree
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

  // Compute levels + declaredChildCount
  function setLevels(n, lvl) {
    n.level = lvl;
    n.declaredChildCount = n.children.length;
    n.children.forEach(c => setLevels(c, lvl + 1));
  }
  if (root) setLevels(root, 0);

  return root;
}

async function generateFromGrist() {
  const baseUrl = getGristBaseUrl();
  const gristKey = document.getElementById('grist-key').value.trim();
  const docId = document.getElementById('grist-doc').value.trim();
  const tableId = document.getElementById('grist-table').value;

  if (!baseUrl) { alert('Renseignez le serveur GRIST.'); return; }
  if (!gristKey) { alert('Renseignez la clé API GRIST.'); return; }
  if (!docId) { alert('Renseignez l\'ID du document.'); return; }
  if (!tableId) { alert('Sélectionnez une table.'); return; }

  const gristRecordsUrl = baseUrl + '/api/docs/' + encodeURIComponent(docId) + '/tables/' + encodeURIComponent(tableId) + '/records';

  const threshold = parseInt(document.getElementById('threshold').value);
  const wrap = document.getElementById('chart-wrap');
  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) emptyEl.style.display = 'none';
  document.getElementById('d3-actions').style.display = 'none';
  clearNodeSelection();
  document.getElementById('top-bar').style.display = 'none';
  document.getElementById('bottom-bar').style.display = 'none';
  wrap.innerHTML = '';
  d3c = null;

  const loader = document.createElement('div');
  loader.className = 'loader';
  const loaderMsg = document.createElement('div');
  loaderMsg.className = 'loader-msg';
  loaderMsg.textContent = 'Chargement GRIST…';
  loader.innerHTML = '<div class="spinner"></div>';
  loader.appendChild(loaderMsg);
  wrap.appendChild(loader);

  const btn = document.getElementById('gen-btn');
  btn.disabled = true;

  try {
    // Configure gouv-source
    const src = document.getElementById('grist-src');
    src.setAttribute('api-type', 'grist');
    src.setAttribute('base-url', gristRecordsUrl);
    src.setAttribute('headers', JSON.stringify({ Authorization: 'Bearer ' + gristKey }));
    src.setAttribute('use-proxy', '');
    src.setAttribute('limit', '0');

    // Configure gouv-normalize
    const norm = document.getElementById('grist-norm');
    norm.setAttribute('source', 'grist-src');
    norm.setAttribute('rename', GRIST_RENAME);
    norm.setAttribute('trim', '');

    // Wait for data
    const records = await new Promise((resolve, reject) => {
      const onData = (e) => {
        norm.removeEventListener('gouv-data-error', onError);
        const data = e.detail || (norm.getData ? norm.getData() : []);
        resolve(Array.isArray(data) ? data : []);
      };
      const onError = (e) => {
        norm.removeEventListener('gouv-data-loaded', onData);
        reject(e.detail || new Error('Erreur GRIST'));
      };
      norm.addEventListener('gouv-data-loaded', onData, { once: true });
      norm.addEventListener('gouv-data-error', onError, { once: true });

      // Trigger fetch
      if (src.reload) src.reload();
    });

    loaderMsg.textContent = `${records.length} enregistrements, construction de l'arbre…`;

    const tree = gristRecordsToTree(records);
    if (!tree) throw new Error('Aucune racine trouvée. Vérifiez que la colonne Parent contient 0 pour l\'entité racine.');

    currentHierarchy = tree;
    const nodeCount = countNodes(tree);
    const depth = maxTreeDepth(tree);

    loader.remove();

    document.getElementById('sc-nodes').textContent = `${nodeCount} noeuds`;
    document.getElementById('sc-depth').textContent = `${depth + 1} niveaux`;
    const modeBadge = document.getElementById('sc-mode');
    const useD3 = nodeCount > threshold;
    modeBadge.textContent = useD3 ? 'D3 interactif' : 'HTML/CSS';
    modeBadge.className = 'fr-badge fr-badge--sm fr-badge--no-icon ' + (useD3 ? 'fr-badge--warning' : 'fr-badge--success');
    document.getElementById('top-bar').style.display = 'flex';
    document.getElementById('bottom-bar').style.display = 'flex';

    if (useD3) {
      renderD3(flattenForD3(tree));
    } else {
      renderSimple(tree);
    }
  } catch (err) {
    loader.remove();
    wrap.innerHTML = `<div class="fr-alert fr-alert--error" role="alert"><h3 class="fr-alert__title">Erreur GRIST</h3><p>${esc(err.message || String(err))}</p></div>`;
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   GÉNÉRATION
══════════════════════════════════════════════════════════════════ */
async function generate() {
  if (document.getElementById('data-source').value === 'grist') {
    return generateFromGrist();
  }

  if (!selectedEntity) {
    alert('Sélectionnez d\'abord une entité via la recherche.');
    return;
  }

  const maxDepth = parseInt(document.getElementById('depth').value);
  const threshold = parseInt(document.getElementById('threshold').value);

  const wrap = document.getElementById('chart-wrap');
  // Safe reset — elements may not exist after first generation
  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) emptyEl.style.display = 'none';
  document.getElementById('d3-actions').style.display = 'none';
  clearNodeSelection();
  document.getElementById('top-bar').style.display = 'none';
  document.getElementById('bottom-bar').style.display = 'none';
  wrap.innerHTML = '';
  d3c = null;

  const loader = document.createElement('div');
  loader.className = 'loader';
  const loaderMsg = document.createElement('div');
  loaderMsg.className = 'loader-msg';
  loaderMsg.textContent = 'Chargement…';
  loader.innerHTML = '<div class="spinner"></div>';
  loader.appendChild(loaderMsg);
  wrap.appendChild(loader);

  const btn = document.getElementById('gen-btn');
  btn.disabled = true;

  try {
    const { tree } = await buildTree(selectedEntity.id, maxDepth, loaderMsg);
    currentHierarchy = tree;

    const nodeCount = countNodes(tree);
    const depth = maxTreeDepth(tree);

    loader.remove();

    document.getElementById('sc-nodes').textContent = `${nodeCount} noeuds`;
    document.getElementById('sc-depth').textContent = `${depth + 1} niveaux`;
    const modeBadge = document.getElementById('sc-mode');
    const useD3 = nodeCount > threshold;
    modeBadge.textContent = useD3 ? 'D3 interactif' : 'HTML/CSS';
    modeBadge.className = 'fr-badge fr-badge--sm fr-badge--no-icon ' + (useD3 ? 'fr-badge--warning' : 'fr-badge--success');
    document.getElementById('top-bar').style.display = 'flex';
    document.getElementById('bottom-bar').style.display = 'flex';

    if (useD3) {
      renderD3(flattenForD3(tree));
    } else {
      renderSimple(tree);
    }
  } catch (err) {
    loader.remove();
    wrap.innerHTML = `<div class="fr-alert fr-alert--error" role="alert"><h3 class="fr-alert__title">Erreur</h3><p>${esc(err.message)}</p><p class="fr-text--sm">URL API : ${API}</p></div>`;
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   EXPORT
══════════════════════════════════════════════════════════════════ */
function doExport(format) {
  if (!currentHierarchy) { alert('Générez d\'abord un organigramme.'); return; }
  if (format === 'json') {
    const h = JSON.parse(JSON.stringify(currentHierarchy, (k, v) => k === '_record' ? undefined : v));
    dlBlob(JSON.stringify(h, null, 2), 'organigramme.json', 'application/json');
  } else if (format === 'csv') {
    const rows = flattenForCSV(currentHierarchy);
    const keys = Object.keys(rows[0] || {});
    const csv = [keys.join(';'), ...rows.map(r => keys.map(k => `"${(r[k] || '').toString().replace(/"/g, '""')}"`).join(';'))].join('\n');
    dlBlob(csv, 'organigramme.csv', 'text/csv;charset=utf-8;');
  } else if (format === 'png') {
    if (d3c) d3c.exportImg({ full: true, scale: 2, backgroundColor: '#fff' });
    else alert('Export PNG uniquement en mode D3.');
  } else if (format === 'svg') {
    if (d3c) d3c.exportSvg();
    else alert('Export SVG uniquement en mode D3.');
  }
}

function doPrint() {
  if (!currentHierarchy) { alert('Générez d\'abord un organigramme.'); return; }

  const fmt = document.getElementById('print-format').value;
  const [size, orient] = fmt.split('-'); // "A4-landscape" → ["A4","landscape"]

  // For D3 mode: expand all and set viewBox so SVG scales to page
  if (d3c) {
    d3c.expandAll().render();
    // Wait for render to settle, then set viewBox
    setTimeout(() => {
      const svg = document.querySelector('#d3-wrap svg');
      if (svg) {
        const bbox = svg.getBBox();
        const pad = 20;
        svg.setAttribute('viewBox',
          `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
      injectPageStyleAndPrint(size, orient);
    }, 600);
  } else {
    injectPageStyleAndPrint(size, orient);
  }
}

function injectPageStyleAndPrint(size, orient) {
  // Inject a dynamic @page rule
  const style = document.createElement('style');
  style.id = 'print-page-style';
  style.textContent = `@page { size: ${size} ${orient}; margin: 10mm; }`;
  document.head.appendChild(style);

  window.print();

  // Cleanup after print dialog
  setTimeout(() => {
    const el = document.getElementById('print-page-style');
    if (el) el.remove();
  }, 1000);
}

function dlBlob(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}

/* ══════════════════════════════════════════════════════════════════
   SAUVEGARDE / RESTAURATION (localStorage)
══════════════════════════════════════════════════════════════════ */
const STORAGE_KEY = 'gouv-orga-saves';

function getSaves() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function putSaves(saves) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saves));
}

function cleanTreeForSave(node) {
  return JSON.parse(JSON.stringify(node, (k, v) => k === '_record' ? undefined : v));
}

function saveToStorage() {
  if (!currentHierarchy) { alert('Aucun organigramme à sauvegarder.'); return; }

  const defaultName = currentHierarchy.name || 'Sans nom';
  const name = prompt('Nom de la sauvegarde :', defaultName);
  if (!name || !name.trim()) return;

  const saves = getSaves();
  const nodeCount = countNodes(currentHierarchy);
  const depth = maxTreeDepth(currentHierarchy);

  saves.unshift({
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    date: new Date().toISOString(),
    nodeCount,
    depth: depth + 1,
    rootName: currentHierarchy.name,
    tree: cleanTreeForSave(currentHierarchy)
  });

  putSaves(saves);
  renderSavesList();

  // Open the disclosure to show the new save
  const disc = document.getElementById('saves-disclosure');
  if (disc) disc.open = true;
}

function loadFromStorage(saveId) {
  const saves = getSaves();
  const save = saves.find(s => s.id === saveId);
  if (!save) { alert('Sauvegarde introuvable.'); return; }

  currentHierarchy = save.tree;

  const threshold = parseInt(document.getElementById('threshold').value);
  const nodeCount = countNodes(currentHierarchy);
  const depth = maxTreeDepth(currentHierarchy);

  // Reset UI
  const wrap = document.getElementById('chart-wrap');
  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) emptyEl.style.display = 'none';
  document.getElementById('d3-actions').style.display = 'none';
  clearNodeSelection();
  wrap.innerHTML = '';
  d3c = null;

  // Update stats
  document.getElementById('sc-nodes').textContent = `${nodeCount} noeuds`;
  document.getElementById('sc-depth').textContent = `${depth + 1} niveaux`;
  const modeBadge = document.getElementById('sc-mode');
  const useD3 = nodeCount > threshold;
  modeBadge.textContent = useD3 ? 'D3 interactif' : 'HTML/CSS';
  modeBadge.className = 'fr-badge fr-badge--sm fr-badge--no-icon ' + (useD3 ? 'fr-badge--warning' : 'fr-badge--success');
  document.getElementById('top-bar').style.display = 'flex';
  document.getElementById('bottom-bar').style.display = 'flex';

  if (useD3) {
    renderD3(flattenForD3(currentHierarchy));
  } else {
    renderSimple(currentHierarchy);
  }
}

function deleteFromStorage(saveId) {
  if (!confirm('Supprimer cette sauvegarde ?')) return;
  const saves = getSaves().filter(s => s.id !== saveId);
  putSaves(saves);
  renderSavesList();
}

function renderSavesList() {
  const container = document.getElementById('saves-list');
  const countEl = document.getElementById('saves-count');
  const saves = getSaves();

  if (countEl) countEl.textContent = saves.length > 0 ? `(${saves.length})` : '';

  if (saves.length === 0) {
    container.innerHTML = '<p class="saves-empty">Aucune sauvegarde</p>';
    return;
  }

  container.innerHTML = saves.map(s => {
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `<div class="save-item" onclick="loadFromStorage('${esc(s.id)}')" title="Charger cette sauvegarde">
      <div class="save-item__info">
        <div class="save-item__name">${esc(s.name)}</div>
        <div class="save-item__meta">${dateStr} ${timeStr} — ${s.nodeCount || '?'} noeuds, ${s.depth || '?'} niveaux</div>
      </div>
      <div class="save-item__actions" onclick="event.stopPropagation()">
        <button class="save-item__btn save-item__btn--delete" onclick="deleteFromStorage('${esc(s.id)}')" title="Supprimer">&#x2715;</button>
      </div>
    </div>`;
  }).join('');
}

// Init saves list on load
renderSavesList();

/* ══════════════════════════════════════════════════════════════════
   TOOLTIP
══════════════════════════════════════════════════════════════════ */
const tt = document.getElementById('tt');
function showTT(e, node) {
  let html = `<div class="tt-title">${esc(node.name)}</div>`;
  if (node.type) html += `<div class="tt-row"><span class="tt-key">Type</span><span class="tt-val">${esc(node.type)}</span></div>`;
  if (node.responsable) html += `<div class="tt-row"><span class="tt-key">Responsable</span><span class="tt-val">${esc(node.responsable.nom)}${node.responsable.role ? ' — ' + esc(node.responsable.role) : ''}</span></div>`;
  if (node.telephone) html += `<div class="tt-row"><span class="tt-key">Tél.</span><span class="tt-val">${esc(node.telephone)}</span></div>`;
  if (node.adresse && node.adresse.formatted) html += `<div class="tt-row"><span class="tt-key">Adresse</span><span class="tt-val">${esc(node.adresse.formatted)}</span></div>`;
  if (node.siren) html += `<div class="tt-row"><span class="tt-key">SIREN</span><span class="tt-val">${esc(node.siren)}</span></div>`;
  if (node.reseauSocial && node.reseauSocial.length > 0) html += `<div class="tt-row"><span class="tt-key">Social</span><span class="tt-val">${node.reseauSocial.map(s => esc(s.platform)).join(', ')}</span></div>`;
  tt.innerHTML = html;
  tt.classList.add('show');
}
function hideTT() { tt.classList.remove('show'); }
document.addEventListener('mousemove', e => {
  if (tt.classList.contains('show')) {
    tt.style.left = (e.clientX + 14) + 'px';
    tt.style.top = (e.clientY + 14) + 'px';
  }
});

/* ══════════════════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════════════════ */
function esc(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
