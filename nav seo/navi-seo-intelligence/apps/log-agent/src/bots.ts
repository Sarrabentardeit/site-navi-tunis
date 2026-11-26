/**
 * Catalogue des robots. À RÉVISER à chaque trimestre : les éditeurs ajoutent et renomment leurs agents.
 * `class` : search = alimente un moteur de recherche/réponse ; training = collecte pour l'entraînement de modèles ;
 *           user_triggered = visite déclenchée par une question d'utilisateur ; other.
 * `rdns` : suffixes DNS attendus pour la vérification par résolution inverse + directe. Sans suffixe, le robot n'est jamais « verified »
 *          (on ne l'affirme pas sans preuve) : il reste « claimed_unverified ».
 */
export type BotClass = "search" | "training" | "user_triggered" | "other";

export interface BotDef {
  readonly name: string;
  readonly pattern: RegExp;
  readonly class: BotClass;
  readonly rdns?: readonly string[];
}

export const BOTS: readonly BotDef[] = [
  { name: "Googlebot", pattern: /Googlebot/i, class: "search", rdns: [".googlebot.com", ".google.com"] },
  { name: "Bingbot", pattern: /bingbot/i, class: "search", rdns: [".search.msn.com"] },
  { name: "Applebot", pattern: /Applebot/i, class: "search", rdns: [".applebot.apple.com"] },
  { name: "OAI-SearchBot", pattern: /OAI-SearchBot/i, class: "search" },
  { name: "ChatGPT-User", pattern: /ChatGPT-User/i, class: "user_triggered" },
  { name: "GPTBot", pattern: /GPTBot/i, class: "training" },
  { name: "Claude-SearchBot", pattern: /Claude-SearchBot/i, class: "search" },
  { name: "Claude-User", pattern: /Claude-User/i, class: "user_triggered" },
  { name: "ClaudeBot", pattern: /ClaudeBot/i, class: "training" },
  { name: "Perplexity-User", pattern: /Perplexity-User/i, class: "user_triggered" },
  { name: "PerplexityBot", pattern: /PerplexityBot/i, class: "search" },
  { name: "CCBot", pattern: /CCBot/i, class: "training" },
  { name: "Bytespider", pattern: /Bytespider/i, class: "training" },
  { name: "meta-externalagent", pattern: /meta-externalagent/i, class: "training" },
  { name: "Amazonbot", pattern: /Amazonbot/i, class: "other" },
];

/** Les motifs les plus spécifiques sont listés avant les génériques (ex. Claude-SearchBot avant ClaudeBot). */
export function classifyUserAgent(ua: string): BotDef | undefined {
  return BOTS.find((b) => b.pattern.test(ua));
}

export type Verification = "verified" | "claimed_unverified" | "failed";

export interface DnsResolver {
  reverse(ip: string): Promise<string[]>;
  forward(host: string): Promise<string[]>;
}

/** Vérification par DNS inverse puis directe : l'hôte doit finir par un suffixe attendu ET résoudre vers la même IP. */
export async function verifyBot(bot: BotDef, ip: string, dns: DnsResolver): Promise<Verification> {
  if (!bot.rdns) return "claimed_unverified";
  try {
    for (const host of await dns.reverse(ip)) {
      const h = host.toLowerCase().replace(/\.$/, "");
      if (!bot.rdns.some((s) => h.endsWith(s))) continue;
      if ((await dns.forward(h)).includes(ip)) return "verified";
    }
    return "failed";
  } catch {
    // DNS indisponible : on ne conclut pas à l'usurpation.
    return "claimed_unverified";
  }
}
