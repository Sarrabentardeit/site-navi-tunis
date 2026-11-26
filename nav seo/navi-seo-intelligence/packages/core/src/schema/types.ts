export type JsonLdValue = string | number | boolean | null | JsonLdNode | JsonLdValue[];
export interface JsonLdNode {
  [key: string]: JsonLdValue | undefined;
}
export interface SchemaGraph {
  "@context": "https://schema.org";
  "@graph": JsonLdNode[];
}
