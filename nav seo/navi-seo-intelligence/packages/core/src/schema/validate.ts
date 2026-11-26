/**
 * Validation structurelle d'un graphe JSON-LD (champs requis par Google, @id uniques,
 * références résolues). Le Rich Results Test n'ayant pas d'API publique, ce contrôle
 * local sert de garde-fou en CI ; le test officiel reste à faire après déploiement.
 */
import type { JsonLdNode, JsonLdValue, SchemaGraph } from "./types";

function typesOf(node: JsonLdNode): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
}

function isNode(v: JsonLdValue | undefined): v is JsonLdNode {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function collectRefs(value: JsonLdValue | undefined, out: string[], isRoot: boolean): void {
  if (Array.isArray(value)) return value.forEach((v) => collectRefs(v, out, false));
  if (!isNode(value)) return;
  const keys = Object.keys(value);
  if (!isRoot && keys.length === 1 && keys[0] === "@id" && typeof value["@id"] === "string") out.push(value["@id"]);
  for (const k of keys) if (k !== "@id") collectRefs(value[k], out, false);
}

/** Collecte les @id définis (nœuds avec @id ET d'autres propriétés), y compris imbriqués. */
function collectDefs(value: JsonLdValue | undefined, out: Set<string>): void {
  if (Array.isArray(value)) return value.forEach((v) => collectDefs(v, out));
  if (!isNode(value)) return;
  const keys = Object.keys(value);
  if (typeof value["@id"] === "string" && keys.length > 1) out.add(value["@id"]);
  for (const k of keys) if (k !== "@id") collectDefs(value[k], out);
}

/** Retourne la liste des problèmes détectés (vide = valide). */
export function validateGraph(graph: SchemaGraph): string[] {
  const issues: string[] = [];
  if (graph["@context"] !== "https://schema.org") issues.push("@context doit valoir https://schema.org");
  const nodes = graph["@graph"];
  if (!Array.isArray(nodes) || nodes.length === 0) return [...issues, "@graph vide ou absent"];

  const seen = new Set<string>();
  for (const node of nodes) {
    const id = node["@id"];
    const types = typesOf(node);
    if (types.length === 0) issues.push(`Nœud sans @type (${String(id)})`);
    if (typeof id === "string") {
      if (seen.has(id)) issues.push(`@id dupliqué : ${id}`);
      seen.add(id);
    }
  }
  const defined = new Set(seen);
  nodes.forEach((n) => collectDefs(n, defined));
  const refs: string[] = [];
  nodes.forEach((n) => collectRefs(n, refs, true));
  for (const ref of refs) if (!defined.has(ref)) issues.push(`Référence @id introuvable : ${ref}`);

  for (const node of nodes) {
    const types = typesOf(node);
    const need = (field: string, label: string): void => {
      const v = node[field];
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) issues.push(`${label} : champ requis « ${field} » manquant`);
    };
    if (types.includes("Organization")) ["name", "url", "logo", "address"].forEach((f) => need(f, "Organization"));
    if (types.includes("WebSite")) ["name", "url"].forEach((f) => need(f, "WebSite"));
    if (types.includes("WebPage") || types.includes("CollectionPage")) ["url", "name"].forEach((f) => need(f, "WebPage"));
    if (types.includes("Service")) ["name", "provider"].forEach((f) => need(f, "Service"));
    if (types.includes("Article")) ["headline", "datePublished", "author", "image"].forEach((f) => need(f, "Article"));
    if (types.includes("BreadcrumbList")) {
      const items = node.itemListElement;
      if (!Array.isArray(items) || items.length < 2) issues.push("BreadcrumbList : au moins 2 éléments requis");
      else
        items.forEach((it, i) => {
          if (!isNode(it) || it.position !== i + 1 || !it.name || !it.item) issues.push(`BreadcrumbList : élément ${i + 1} invalide`);
        });
    }
    if (types.includes("FAQPage")) {
      const q = node.mainEntity;
      if (!Array.isArray(q) || q.length === 0) issues.push("FAQPage : mainEntity vide");
      else
        q.forEach((item, i) => {
          const ans = isNode(item) && isNode(item.acceptedAnswer) ? item.acceptedAnswer.text : undefined;
          if (!isNode(item) || !item.name || typeof ans !== "string" || ans === "") issues.push(`FAQPage : question ${i + 1} incomplète`);
        });
    }
  }
  return issues;
}
