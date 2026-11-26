import { serializeJsonLd } from "../schema/serialize";
import type { GraphOptions } from "../schema/graph";
import type { JsonLdNode, SchemaGraph } from "../schema/types";
import type { SeoKit } from "../kit";

/** Injecte du JSON-LD (Server Component, zéro JS client). */
export function JsonLd({ data }: { data: SchemaGraph | JsonLdNode | JsonLdNode[] }): React.JSX.Element {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

/**
 * Graphe complet d'une page à partir du kit du site.
 * @example <PageJsonLd kit={seo} path="/odoo" />
 * @example <PageJsonLd kit={seo} path="/" faq={homeFaq} />
 */
export function PageJsonLd({ kit, path, ...options }: { kit: SeoKit; path: string } & GraphOptions): React.JSX.Element {
  return <JsonLd data={kit.buildGraph(path, options)} />;
}
