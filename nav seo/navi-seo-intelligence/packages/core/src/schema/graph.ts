/**
 * Graphe JSON-LD connecté (approche Yoast) : Organization/ProfessionalService, WebSite,
 * WebPage, BreadcrumbList, Service, Article, FAQPage reliés par des @id.
 */
import type { FaqItem, PageEntry, SeoContext } from "../types";
import { absoluteUrl, getPage, normalizePath } from "../pages";
import { buildOgImageUrl } from "../metadata";
import type { JsonLdNode, SchemaGraph } from "./types";

export function ids(ctx: SeoContext) {
  const u = ctx.site.url;
  return {
    org: `${u}/#organization`,
    website: `${u}/#website`,
    logo: `${u}/#logo`,
    page: (path: string): string => `${absoluteUrl(ctx, path)}#webpage`,
    breadcrumb: (path: string): string => `${absoluteUrl(ctx, path)}#breadcrumb`,
    service: (path: string): string => `${absoluteUrl(ctx, path)}#service`,
    article: (path: string): string => `${absoluteUrl(ctx, path)}#article`,
    faq: (path: string): string => `${absoluteUrl(ctx, path)}#faq`,
  };
}

/** Organisation (et ProfessionalService) avec coordonnées UK et catalogue de services. */
export function buildOrganization(ctx: SeoContext): JsonLdNode {
  const a = ctx.site.address;
  return {
    "@type": ["Organization", "ProfessionalService"],
    "@id": ids(ctx).org,
    name: ctx.site.name,
    legalName: ctx.site.legalName,
    url: ctx.site.url,
    description: ctx.site.description,
    logo: { "@type": "ImageObject", "@id": ids(ctx).logo, url: absoluteUrl(ctx, ctx.site.logoPath), contentUrl: absoluteUrl(ctx, ctx.site.logoPath), caption: ctx.site.name },
    image: { "@id": ids(ctx).logo },
    email: ctx.site.contact.email,
    telephone: ctx.site.contact.telephone,
    address: { "@type": "PostalAddress", streetAddress: a.streetAddress, addressLocality: a.addressLocality, postalCode: a.postalCode, addressCountry: a.addressCountry },
    areaServed: [...ctx.site.areaServed],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "sales",
      email: ctx.site.contact.email,
      telephone: ctx.site.contact.telephone,
      areaServed: [...ctx.site.areaServed],
      availableLanguage: ["English"],
    },
    ...(ctx.site.sameAs.length > 0 ? { sameAs: [...ctx.site.sameAs] } : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `${ctx.site.name} services`,
      itemListElement: ctx.site.serviceFamilies.map((family) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: family.name, description: `${family.tagline} ${family.offerings.join(", ")}.`, provider: { "@id": ids(ctx).org } },
      })),
    },
  };
}

/** Nœud WebSite. */
export function buildWebSite(ctx: SeoContext): JsonLdNode {
  return { "@type": "WebSite", "@id": ids(ctx).website, url: ctx.site.url, name: ctx.site.name, description: ctx.site.description, inLanguage: ctx.site.language, publisher: { "@id": ids(ctx).org } };
}

/** Nœud WebPage (ou sous-type) pour une page du registre. */
export function buildWebPage(ctx: SeoContext, entry: PageEntry, hasBreadcrumb: boolean): JsonLdNode {
  const type = entry.path === "/insights" ? "CollectionPage" : "WebPage";
  return {
    "@type": type,
    "@id": ids(ctx).page(entry.path),
    url: absoluteUrl(ctx, entry.path),
    name: entry.type === "home" ? `${ctx.site.name} | ${ctx.site.tagline}` : `${entry.title} | ${ctx.site.name}`,
    description: entry.description,
    inLanguage: ctx.site.language,
    isPartOf: { "@id": ids(ctx).website },
    about: { "@id": ids(ctx).org },
    primaryImageOfPage: { "@type": "ImageObject", url: buildOgImageUrl(ctx, entry) },
    ...(hasBreadcrumb ? { breadcrumb: { "@id": ids(ctx).breadcrumb(entry.path) } } : {}),
    ...(entry.datePublished ? { datePublished: entry.datePublished } : {}),
    ...(entry.lastModified ? { dateModified: entry.lastModified } : {}),
  };
}

/** Fil d'Ariane : seuls les segments présents dans le registre sont inclus. */
export function buildBreadcrumb(ctx: SeoContext, entry: PageEntry): JsonLdNode | undefined {
  if (entry.path === "/") return undefined;
  const segments = entry.path.split("/").filter(Boolean);
  const trail: { name: string; url: string }[] = [{ name: "Home", url: absoluteUrl(ctx, "/") }];
  segments.forEach((_s, i) => {
    const p = `/${segments.slice(0, i + 1).join("/")}`;
    const page = getPage(ctx, p);
    if (page) trail.push({ name: page.breadcrumbLabel ?? page.title, url: absoluteUrl(ctx, p) });
  });
  if (trail.length < 2) return undefined;
  return {
    "@type": "BreadcrumbList",
    "@id": ids(ctx).breadcrumb(entry.path),
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: t.url })),
  };
}

/** Nœud Service pour une page de service. */
export function buildService(ctx: SeoContext, entry: PageEntry): JsonLdNode {
  return {
    "@type": "Service",
    "@id": ids(ctx).service(entry.path),
    name: entry.title,
    description: entry.description,
    url: absoluteUrl(ctx, entry.path),
    serviceType: entry.section ?? entry.title,
    provider: { "@id": ids(ctx).org },
    areaServed: [...ctx.site.areaServed],
    mainEntityOfPage: { "@id": ids(ctx).page(entry.path) },
  };
}

/** Nœud Article (contenu Insights). */
export function buildArticle(ctx: SeoContext, entry: PageEntry): JsonLdNode {
  return {
    "@type": "Article",
    "@id": ids(ctx).article(entry.path),
    headline: entry.title.slice(0, 110),
    description: entry.description,
    image: [buildOgImageUrl(ctx, entry)],
    ...(entry.datePublished ? { datePublished: entry.datePublished } : {}),
    dateModified: entry.lastModified ?? entry.datePublished,
    author: { "@id": ids(ctx).org },
    publisher: { "@id": ids(ctx).org },
    mainEntityOfPage: { "@id": ids(ctx).page(entry.path) },
    inLanguage: ctx.site.language,
  };
}

/** Nœud FAQPage. */
export function buildFaq(ctx: SeoContext, path: string, items: readonly FaqItem[]): JsonLdNode {
  return {
    "@type": "FAQPage",
    "@id": ids(ctx).faq(path),
    isPartOf: { "@id": ids(ctx).page(path) },
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.question, acceptedAnswer: { "@type": "Answer", text: i.answer } })),
  };
}

export interface GraphOptions {
  readonly faq?: readonly FaqItem[];
  /** Surcharge de l'entrée du registre (pages dynamiques). */
  readonly overrides?: Partial<PageEntry>;
}

/**
 * Construit le graphe JSON-LD complet d'une page.
 * @param path Chemin de la page.
 */
export function buildGraph(ctx: SeoContext, path: string, options: GraphOptions = {}): SchemaGraph {
  const p = normalizePath(path);
  const base = getPage(ctx, p) ?? { path: p, type: "page" as const, title: ctx.site.name, description: ctx.site.description };
  const entry: PageEntry = { ...base, ...options.overrides };
  const breadcrumb = buildBreadcrumb(ctx, entry);
  const graph: JsonLdNode[] = [buildOrganization(ctx), buildWebSite(ctx), buildWebPage(ctx, entry, breadcrumb !== undefined)];
  if (breadcrumb) graph.push(breadcrumb);
  if (entry.type === "service") graph.push(buildService(ctx, entry));
  if (entry.type === "article") graph.push(buildArticle(ctx, entry));
  if (options.faq && options.faq.length > 0) graph.push(buildFaq(ctx, entry.path, options.faq));
  return { "@context": "https://schema.org", "@graph": graph };
}
