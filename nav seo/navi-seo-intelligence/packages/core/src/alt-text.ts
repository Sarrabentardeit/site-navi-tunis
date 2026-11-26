/** Génération automatique d'alt text à partir de règles configurables. */
import { renderTemplate, truncate } from "./templates";

export interface AltContext {
  readonly pageTitle?: string;
  readonly section?: string;
  readonly keywords?: readonly string[];
}

export interface AltRules {
  /** Pattern avec variables : %filename% %pagetitle% %section% %keyword%. */
  readonly pattern: string;
  /** Pattern utilisé quand le nom de fichier n'est pas exploitable (IMG_1234.jpg…). */
  readonly fallbackPattern: string;
  readonly maxLength: number;
  /** Fragments supprimés du nom de fichier (ex. suffixes de dimensions). */
  readonly stripPatterns: readonly RegExp[];
  /** Noms de fichiers génériques considérés comme inexploitables. */
  readonly genericNames: readonly RegExp[];
}

export const defaultAltRules: AltRules = {
  pattern: "%filename% — %pagetitle%",
  fallbackPattern: "%pagetitle% — %section%",
  maxLength: 125,
  stripPatterns: [/[-_.]\d{2,5}x\d{2,5}$/i, /[-_.@](?:[0-9a-f]{8,}|\d{2,3}x)$/i, /[-_.](?:scaled|copy|final|v\d+)$/i],
  genericNames: [/^(?:img|image|dsc|dscn|photo|picture|screenshot|capture|untitled|unnamed|file)[-_ ]?\d*$/i, /^\d+$/],
};

/** Extrait le nom de fichier d'un src (gère /_next/image?url=…). */
function basenameOf(src: string): string {
  let target = src;
  const q = src.match(/[?&]url=([^&]+)/);
  if (q?.[1]) target = decodeURIComponent(q[1]);
  const noQuery = target.split(/[?#]/)[0] ?? "";
  return noQuery.split("/").filter(Boolean).pop() ?? "";
}

/**
 * Nettoie un nom de fichier en texte lisible : "software-dashboard_1200x800.jpg" → "Software dashboard".
 * Retourne "" si le nom est inexploitable.
 */
export function cleanFilename(src: string, rules: AltRules = defaultAltRules): string {
  let name = basenameOf(src).replace(/\.[a-z0-9]{2,5}$/i, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    /* nom non décodable : on garde tel quel */
  }
  for (const re of rules.stripPatterns) name = name.replace(re, "");
  if (rules.genericNames.some((re) => re.test(name))) return "";
  const text = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (text === "" || /^\d+$/.test(text)) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Génère un alt à partir du src et du contexte de page.
 * Rappel : un alt rédigé à la main reste toujours préférable.
 */
export function generateAlt(src: string, context: AltContext = {}, rules: AltRules = defaultAltRules): string {
  const filename = cleanFilename(src, rules);
  const vars = { filename, pagetitle: context.pageTitle, section: context.section, keyword: context.keywords?.[0] };
  const pattern = filename === "" ? rules.fallbackPattern : rules.pattern;
  return truncate(renderTemplate(pattern, vars), rules.maxLength);
}
