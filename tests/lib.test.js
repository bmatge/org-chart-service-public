import { describe, it, expect } from 'vitest';
import {
  esc, getChildIds, parseAdresse, parseResponsable, parseTelephone,
  parseReseauSocial, parseGristSocial, parseModalSocial,
  entityToNode, countNodes, maxTreeDepth, flattenForD3, flattenForCSV,
  findNode, detachNode, gristRecordsToTree, cleanTreeForSave
} from '../lib.js';

/* ══════════════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════════════ */

function makeNode(id, name, children = []) {
  return {
    id, name, ancienNom: null, type: '', level: 0, children,
    responsable: null, telephone: null, adresse: null,
    formulaireContact: null, siren: null, reseauSocial: [],
    urlSP: '', declaredChildCount: children.length, _record: null
  };
}

function makeTree() {
  const c1 = makeNode('c1', 'Enfant 1');
  const c2 = makeNode('c2', 'Enfant 2');
  const c3 = makeNode('c3', 'Petit-enfant');
  c2.children = [c3];
  c2.declaredChildCount = 1;
  const root = makeNode('r', 'Racine', [c1, c2]);
  root.level = 0; c1.level = 1; c2.level = 1; c3.level = 2;
  return root;
}

/* ══════════════════════════════════════════════════════════════════
   esc
══════════════════════════════════════════════════════════════════ */
describe('esc', () => {
  it('echappe les chevrons', () => {
    expect(esc('<b>hi</b>')).toBe('&lt;b&gt;hi&lt;/b&gt;');
  });
  it('echappe &', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });
  it('echappe les guillemets', () => {
    expect(esc('"ok"')).toBe('&quot;ok&quot;');
  });
  it('retourne chaine vide pour null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
  it('convertit les nombres en string', () => {
    expect(esc(42)).toBe('42');
  });
});

/* ══════════════════════════════════════════════════════════════════
   getChildIds
══════════════════════════════════════════════════════════════════ */
describe('getChildIds', () => {
  it('retourne [] pour null/undefined', () => {
    expect(getChildIds(null)).toEqual([]);
    expect(getChildIds(undefined)).toEqual([]);
  });
  it('retourne [] pour JSON invalide', () => {
    expect(getChildIds('pas du json')).toEqual([]);
  });
  it('retourne [] pour tableau vide', () => {
    expect(getChildIds('[]')).toEqual([]);
  });
  it('filtre uniquement les Service Fils', () => {
    const input = JSON.stringify([
      { type_hierarchie: 'Service Fils', service: 'id1' },
      { type_hierarchie: 'Service Pere', service: 'id2' },
      { type_hierarchie: 'Service Fils', service: 'id3' }
    ]);
    expect(getChildIds(input)).toEqual(['id1', 'id3']);
  });
  it('accepte un tableau deja parse', () => {
    const arr = [{ type_hierarchie: 'Service Fils', service: 'x' }];
    expect(getChildIds(arr)).toEqual(['x']);
  });
  it('filtre les service null', () => {
    const arr = [{ type_hierarchie: 'Service Fils', service: null }];
    expect(getChildIds(arr)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════
   parseAdresse
══════════════════════════════════════════════════════════════════ */
describe('parseAdresse', () => {
  it('retourne null pour null', () => {
    expect(parseAdresse(null)).toBeNull();
  });
  it('retourne null pour tableau vide', () => {
    expect(parseAdresse('[]')).toBeNull();
  });
  it('parse une adresse complete', () => {
    const input = JSON.stringify([{
      type_adresse: 'Adresse',
      numero_voie: '1 rue de la Paix',
      code_postal: '75001',
      nom_commune: 'Paris'
    }]);
    const result = parseAdresse(input);
    expect(result).toEqual({
      formatted: '1 rue de la Paix, 75001 Paris',
      commune: 'Paris',
      cp: '75001'
    });
  });
  it('prefere le type Adresse', () => {
    const input = [
      { type_adresse: 'Autre', numero_voie: 'Autre rue', code_postal: '69000', nom_commune: 'Lyon' },
      { type_adresse: 'Adresse', numero_voie: '10 bd Haussmann', code_postal: '75009', nom_commune: 'Paris' }
    ];
    const result = parseAdresse(input);
    expect(result.commune).toBe('Paris');
  });
  it('fallback sur la premiere entree si pas de type Adresse', () => {
    const input = [{ type_adresse: 'Autre', numero_voie: 'X', code_postal: '13000', nom_commune: 'Marseille' }];
    const result = parseAdresse(input);
    expect(result.commune).toBe('Marseille');
  });
  it('gere les champs manquants', () => {
    const input = [{ type_adresse: 'Adresse' }];
    const result = parseAdresse(input);
    expect(result).toEqual({ formatted: '', commune: '', cp: '' });
  });
});

/* ══════════════════════════════════════════════════════════════════
   parseResponsable
══════════════════════════════════════════════════════════════════ */
describe('parseResponsable', () => {
  it('retourne null pour null', () => {
    expect(parseResponsable(null)).toBeNull();
  });
  it('parse avec wrapper personne', () => {
    const input = JSON.stringify([{
      personne: { prenom: 'Jean', nom: 'Dupont' },
      fonction: 'Directeur'
    }]);
    expect(parseResponsable(input)).toEqual({ nom: 'Jean Dupont', role: 'Directeur' });
  });
  it('parse sans wrapper personne (format plat)', () => {
    const input = [{ prenom: 'Marie', nom: 'Curie', qualite: 'Chef' }];
    expect(parseResponsable(input)).toEqual({ nom: 'Marie Curie', role: 'Chef' });
  });
  it('retourne null si pas de nom/prenom', () => {
    const input = [{ personne: {} }];
    expect(parseResponsable(input)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
   parseTelephone
══════════════════════════════════════════════════════════════════ */
describe('parseTelephone', () => {
  it('retourne null pour null', () => {
    expect(parseTelephone(null)).toBeNull();
  });
  it('parse la premiere valeur', () => {
    const input = JSON.stringify([{ valeur: '+33 1 23 45 67 89' }]);
    expect(parseTelephone(input)).toBe('+33 1 23 45 67 89');
  });
  it('retourne null pour tableau vide', () => {
    expect(parseTelephone('[]')).toBeNull();
  });
  it('retourne null si pas de valeur', () => {
    expect(parseTelephone('[{"autre":"x"}]')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
   parseReseauSocial
══════════════════════════════════════════════════════════════════ */
describe('parseReseauSocial', () => {
  it('retourne [] pour null', () => {
    expect(parseReseauSocial(null)).toEqual([]);
  });
  it('parse avec custom_dico2', () => {
    const input = [{ valeur: 'https://twitter.com/x', custom_dico2: 'Twitter' }];
    expect(parseReseauSocial(input)).toEqual([{ url: 'https://twitter.com/x', platform: 'Twitter' }]);
  });
  it('fallback sur description', () => {
    const input = [{ valeur: 'https://fb.com', description: 'Facebook' }];
    expect(parseReseauSocial(input)).toEqual([{ url: 'https://fb.com', platform: 'Facebook' }]);
  });
  it('fallback sur Lien', () => {
    const input = [{ valeur: 'https://example.com' }];
    expect(parseReseauSocial(input)).toEqual([{ url: 'https://example.com', platform: 'Lien' }]);
  });
  it('filtre les url vides', () => {
    const input = [{ valeur: '', custom_dico2: 'Twitter' }];
    expect(parseReseauSocial(input)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════
   parseGristSocial
══════════════════════════════════════════════════════════════════ */
describe('parseGristSocial', () => {
  it('retourne [] pour null/vide', () => {
    expect(parseGristSocial(null)).toEqual([]);
    expect(parseGristSocial('')).toEqual([]);
  });
  it('parse le format plateforme:url multiligne', () => {
    const input = 'Twitter:https://t.co/x\nFacebook:https://fb.com/y';
    expect(parseGristSocial(input)).toEqual([
      { platform: 'Twitter', url: 'https://t.co/x' },
      { platform: 'Facebook', url: 'https://fb.com/y' }
    ]);
  });
  it('utilise Lien si pas de separateur', () => {
    expect(parseGristSocial('example.com')).toEqual([
      { platform: 'Lien', url: 'example.com' }
    ]);
  });
  it('split sur le premier : (URL avec scheme)', () => {
    expect(parseGristSocial('https://example.com')).toEqual([
      { platform: 'https', url: '//example.com' }
    ]);
  });
  it('ignore les lignes vides', () => {
    const input = 'Twitter:https://t.co\n\n  \nFB:https://fb.com';
    expect(parseGristSocial(input)).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════
   parseModalSocial
══════════════════════════════════════════════════════════════════ */
describe('parseModalSocial', () => {
  it('parse le format multiligne', () => {
    expect(parseModalSocial('X:https://x.com')).toEqual([
      { platform: 'X', url: 'https://x.com' }
    ]);
  });
  it('retourne [] pour chaine vide', () => {
    expect(parseModalSocial('')).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════
   entityToNode
══════════════════════════════════════════════════════════════════ */
describe('entityToNode', () => {
  it('cree un noeud complet depuis un record API', () => {
    const record = {
      id: '123',
      nom: 'Direction Generale',
      ancien_nom: 'Ex-DG',
      type_organisme: 'SI',
      adresse: JSON.stringify([{ type_adresse: 'Adresse', numero_voie: '1 rue X', code_postal: '75001', nom_commune: 'Paris' }]),
      affectation_personne: JSON.stringify([{ personne: { prenom: 'Jean', nom: 'Dupont' }, fonction: 'DG' }]),
      telephone: JSON.stringify([{ valeur: '01 23 45' }]),
      reseau_social: JSON.stringify([{ valeur: 'https://twitter.com/dg', custom_dico2: 'Twitter' }]),
      hierarchie: JSON.stringify([{ type_hierarchie: 'Service Fils', service: 'c1' }]),
      formulaire_contact: 'https://contact.gouv.fr',
      siren: '123456789',
      url_service_public: 'https://sp.gouv.fr/123'
    };
    const node = entityToNode(record, 0);
    expect(node.id).toBe('123');
    expect(node.name).toBe('Direction Generale');
    expect(node.ancienNom).toBe('Ex-DG');
    expect(node.level).toBe(0);
    expect(node.responsable).toEqual({ nom: 'Jean Dupont', role: 'DG' });
    expect(node.telephone).toBe('01 23 45');
    expect(node.adresse.commune).toBe('Paris');
    expect(node.reseauSocial).toHaveLength(1);
    expect(node.declaredChildCount).toBe(1);
    expect(node._record).toBe(record);
  });
  it('gere un record minimal', () => {
    const node = entityToNode({ id: 'x' }, 2);
    expect(node.id).toBe('x');
    expect(node.name).toBe('Sans nom');
    expect(node.level).toBe(2);
    expect(node.children).toEqual([]);
    expect(node.responsable).toBeNull();
    expect(node.telephone).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
   countNodes
══════════════════════════════════════════════════════════════════ */
describe('countNodes', () => {
  it('compte 1 pour une feuille', () => {
    expect(countNodes(makeNode('a', 'A'))).toBe(1);
  });
  it('compte correctement un arbre', () => {
    expect(countNodes(makeTree())).toBe(4);
  });
  it('gere un noeud sans children', () => {
    expect(countNodes({ id: 'x' })).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════
   maxTreeDepth
══════════════════════════════════════════════════════════════════ */
describe('maxTreeDepth', () => {
  it('retourne 0 pour une feuille', () => {
    expect(maxTreeDepth(makeNode('a', 'A'))).toBe(0);
  });
  it('retourne la profondeur max', () => {
    expect(maxTreeDepth(makeTree())).toBe(2);
  });
  it('gere un arbre desequilibre', () => {
    const root = makeNode('r', 'R', [
      makeNode('a', 'A'),
      makeNode('b', 'B', [makeNode('c', 'C', [makeNode('d', 'D')])])
    ]);
    expect(maxTreeDepth(root)).toBe(3);
  });
});

/* ══════════════════════════════════════════════════════════════════
   flattenForD3
══════════════════════════════════════════════════════════════════ */
describe('flattenForD3', () => {
  it('aplatit un arbre', () => {
    const tree = makeTree();
    const flat = flattenForD3(tree);
    expect(flat).toHaveLength(4);
    expect(flat[0].id).toBe('r');
    expect(flat[0].parentId).toBeNull();
  });
  it('assigne les parentId corrects', () => {
    const tree = makeTree();
    const flat = flattenForD3(tree);
    const child = flat.find(n => n.id === 'c1');
    expect(child.parentId).toBe('r');
    const grandchild = flat.find(n => n.id === 'c3');
    expect(grandchild.parentId).toBe('c2');
  });
  it('inclut les champs attendus', () => {
    const tree = makeTree();
    tree.responsable = { nom: 'Test', role: 'Chef' };
    const flat = flattenForD3(tree);
    expect(flat[0].responsable).toBe('Test');
    expect(flat[0].role).toBe('Chef');
  });
});

/* ══════════════════════════════════════════════════════════════════
   flattenForCSV
══════════════════════════════════════════════════════════════════ */
describe('flattenForCSV', () => {
  it('aplatit un arbre en lignes CSV', () => {
    const tree = makeTree();
    const rows = flattenForCSV(tree);
    expect(rows).toHaveLength(4);
    expect(rows[0].nom).toBe('Racine');
  });
  it('joint les reseaux sociaux avec |', () => {
    const tree = makeNode('a', 'A');
    tree.reseauSocial = [
      { platform: 'Twitter', url: 'https://t.co' },
      { platform: 'FB', url: 'https://fb.com' }
    ];
    const rows = flattenForCSV(tree);
    expect(rows[0].reseaux_sociaux).toBe('Twitter:https://t.co | FB:https://fb.com');
  });
});

/* ══════════════════════════════════════════════════════════════════
   findNode
══════════════════════════════════════════════════════════════════ */
describe('findNode', () => {
  it('trouve la racine', () => {
    const tree = makeTree();
    expect(findNode(tree, 'r').name).toBe('Racine');
  });
  it('trouve un enfant profond', () => {
    const tree = makeTree();
    expect(findNode(tree, 'c3').name).toBe('Petit-enfant');
  });
  it('retourne null si non trouve', () => {
    const tree = makeTree();
    expect(findNode(tree, 'inexistant')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
   detachNode
══════════════════════════════════════════════════════════════════ */
describe('detachNode', () => {
  it('detache un enfant direct', () => {
    const tree = makeTree();
    const detached = detachNode(tree, 'c1');
    expect(detached.name).toBe('Enfant 1');
    expect(tree.children).toHaveLength(1);
  });
  it('detache un petit-enfant', () => {
    const tree = makeTree();
    const detached = detachNode(tree, 'c3');
    expect(detached.name).toBe('Petit-enfant');
    expect(findNode(tree, 'c2').children).toHaveLength(0);
  });
  it('retourne null si non trouve', () => {
    const tree = makeTree();
    expect(detachNode(tree, 'nope')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
   gristRecordsToTree
══════════════════════════════════════════════════════════════════ */
describe('gristRecordsToTree', () => {
  it('construit un arbre simple', () => {
    const records = [
      { id: 1, name: 'Racine', parentId: 0 },
      { id: 2, name: 'Enfant A', parentId: 1 },
      { id: 3, name: 'Enfant B', parentId: 1 }
    ];
    const tree = gristRecordsToTree(records);
    expect(tree.name).toBe('Racine');
    expect(tree.children).toHaveLength(2);
    expect(tree.level).toBe(0);
    expect(tree.children[0].level).toBe(1);
  });
  it('gere parentId null comme racine', () => {
    const records = [{ id: 1, name: 'Root', parentId: null }];
    const tree = gristRecordsToTree(records);
    expect(tree.name).toBe('Root');
  });
  it('retourne null sans racine', () => {
    const records = [{ id: 1, name: 'Orphan', parentId: 99 }];
    expect(gristRecordsToTree(records)).toBeNull();
  });
  it('calcule les niveaux et declaredChildCount', () => {
    const records = [
      { id: 1, name: 'R', parentId: 0 },
      { id: 2, name: 'A', parentId: 1 },
      { id: 3, name: 'B', parentId: 2 }
    ];
    const tree = gristRecordsToTree(records);
    expect(tree.declaredChildCount).toBe(1);
    expect(tree.children[0].declaredChildCount).toBe(1);
    expect(tree.children[0].children[0].level).toBe(2);
  });
  it('convertit les ids en string', () => {
    const records = [{ id: 42, name: 'X', parentId: 0 }];
    const tree = gristRecordsToTree(records);
    expect(tree.id).toBe('42');
  });
});

/* ══════════════════════════════════════════════════════════════════
   cleanTreeForSave
══════════════════════════════════════════════════════════════════ */
describe('cleanTreeForSave', () => {
  it('supprime _record', () => {
    const node = makeNode('a', 'A');
    node._record = { big: 'data' };
    const clean = cleanTreeForSave(node);
    expect(clean._record).toBeUndefined();
  });
  it('supprime _record recursivement', () => {
    const tree = makeTree();
    tree._record = { x: 1 };
    tree.children[0]._record = { y: 2 };
    const clean = cleanTreeForSave(tree);
    expect(clean._record).toBeUndefined();
    expect(clean.children[0]._record).toBeUndefined();
  });
  it('ne modifie pas le noeud original', () => {
    const node = makeNode('a', 'A');
    node._record = { data: true };
    cleanTreeForSave(node);
    expect(node._record).toEqual({ data: true });
  });
  it('preserve les autres proprietes', () => {
    const node = makeNode('a', 'Test');
    node.siren = '123';
    const clean = cleanTreeForSave(node);
    expect(clean.name).toBe('Test');
    expect(clean.siren).toBe('123');
  });
});
