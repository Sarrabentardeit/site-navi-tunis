/**
 * Moteur de templates à variables (équivalent des variables Rank Math).
 * Variables : %sitename% %tagline% %pagetitle% %description% %section% %sep% %year% ...
 */
export type TemplateVars = Readonly<Record<string, string | undefined>>;

const VARIABLE = /%([a-z_]+)%/gi;

/**
 * Remplace les variables `%nom%` et nettoie les séparateurs orphelins.
 * Une variable inconnue ou vide est remplacée par une chaîne vide.
 * @example renderTemplate("%pagetitle% | %sitename%", { pagetitle: "Odoo", sitename: "Navitrends UK" }) // "Odoo | Navitrends UK"
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const filled = template.replace(VARIABLE, (_m, name: string) => vars[name.toLowerCase()] ?? "");
  return filled
    .replace(/\s+/g, " ")
    .replace(/(\s[|–—·-])(?:\s+[|–—·-])+(?=\s)/g, "$1")
    .replace(/^(?:\s*[|–—·]\s*|\s+-\s+)+|(?:\s*[|–—·]\s*|\s+-\s+)+$/g, "")
    .trim();
}

/**
 * Tronque à `max` caractères en coupant sur un mot et en ajoutant « … ».
 */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.replace(/[\s,;:.\-–—]+$/, "")}…`;
}
