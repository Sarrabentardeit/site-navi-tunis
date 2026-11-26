const DOMAIN = /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * Accepte « https://Exemple.com/ » ou « exemple.com » ; refuse IP, ports, chemins, identifiants, caractères non ASCII
 * (un domaine IDN s'enregistre en punycode). Le domaine enregistré est celui que le worker ira crawler : la validation est stricte.
 */
export function normalizeDomain(input: string): string | undefined {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return DOMAIN.test(d) && !/^\d+(\.\d+){3}$/.test(d) ? d : undefined;
}
