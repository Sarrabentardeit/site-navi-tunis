/**
 * Registre des modules produit (architecture §4.2). Un module non livré n'a pas de maquette :
 * il est masqué ou marqué « Bientôt ». `modules_enabled` (par organisation) peut activer un module livré.
 */
export interface ProductModule {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Phase du plan d'ouverture. */
  readonly phase: number;
  /** true quand la page existe réellement dans ce dépôt. */
  readonly shipped: boolean;
}

export const MODULES: readonly ProductModule[] = [
  { id: "dashboard", label: "Dashboard", href: "/", phase: 1, shipped: true },
  { id: "seo-audit", label: "Technical SEO", href: "/seo/audit", phase: 1, shipped: true },
  { id: "seo-overview", label: "SEO Intelligence", href: "/seo/overview", phase: 2, shipped: false },
  { id: "keywords", label: "Keyword Intelligence", href: "/seo/keywords", phase: 3, shipped: false },
  { id: "competitors", label: "Competitors & Backlinks", href: "/seo/competitors", phase: 4, shipped: false },
  { id: "geo", label: "GEO / AI Intelligence", href: "/geo/visibility", phase: 5, shipped: false },
  { id: "citations", label: "Citations & AI Bots", href: "/geo/bots", phase: 6, shipped: false },
  { id: "content", label: "Content Intelligence", href: "/content", phase: 7, shipped: false },
  { id: "reports", label: "Reporting", href: "/reports", phase: 8, shipped: false },
  { id: "settings", label: "Settings", href: "/settings", phase: 1, shipped: true },
];

export type ModuleView = ProductModule & { readonly state: "available" | "coming_soon" };

/** Modules livrés : toujours disponibles. Modules non livrés : « Bientôt » (liste complète) — jamais un lien mort vers une page inexistante. */
export function moduleViews(): ModuleView[] {
  return MODULES.map((m) => ({ ...m, state: m.shipped ? "available" : "coming_soon" }));
}

/** Un module livré mais dont la route n'est pas ouverte pour l'organisation (modules_enabled non vide) est masqué. */
export function visibleModules(modulesEnabled: readonly string[]): ModuleView[] {
  const restricted = modulesEnabled.length > 0;
  return moduleViews().filter((m) => m.state === "coming_soon" || !restricted || m.id === "dashboard" || m.id === "settings" || modulesEnabled.includes(m.id));
}
