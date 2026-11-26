import type { JsonLdNode, SchemaGraph } from "./types";

/**
 * Sérialise du JSON-LD en échappant `<` (anti-injection `</script>`) et les séparateurs U+2028/2029.
 */
export function serializeJsonLd(data: SchemaGraph | JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
