import type { PageEntry, SeoContext } from "./types";
import { absoluteUrl, getIndexablePages } from "./pages";

/** Construit le contenu de llms.txt à partir de la config du site et du registre des pages. */
export function buildLlmsTxt(ctx: SeoContext): string {
  const site = ctx.site;
  const link = (page: PageEntry): string => `- [${page.title}](${absoluteUrl(ctx, page.path)}): ${page.description}`;
  const all = getIndexablePages(ctx);
  const byType = (type: PageEntry["type"]): PageEntry[] => all.filter((p) => p.type === type);
  const a = site.address;

  const families = site.serviceFamilies.map((f) => `- **${f.name}** — ${f.tagline} ${f.offerings.join("; ")}.`).join("\n");

  const sections: string[] = [
    `# ${site.name}`,
    `> ${site.description}`,
    `${site.legalName} is registered in ${a.addressLocality}, United Kingdom, and works with organisations in ${site.areaServed.join(", ")}.`,
    `## What we do\n${families}`,
  ];
  const services = byType("service");
  if (services.length > 0) sections.push(`## Service pages\n${services.map(link).join("\n")}`);
  const cases = byType("case-study");
  if (cases.length > 0) sections.push(`## Case studies\n${cases.map(link).join("\n")}`);
  const articles = [...byType("article"), ...all.filter((p) => p.path === "/insights")];
  if (articles.length > 0) sections.push(`## Insights\n${articles.map(link).join("\n")}`);
  sections.push(
    `## Contact\n- Email: ${site.contact.email}\n- Phone: ${site.contact.telephone}\n- Address: ${a.streetAddress}, ${a.addressLocality} ${a.postalCode}, United Kingdom\n- Offer: a 30-minute operational digitalisation diagnostic (one process, one bottleneck, one KPI).\n- Book: ${absoluteUrl(ctx, "/")}#contact`,
  );
  const legal = byType("legal");
  if (legal.length > 0) sections.push(`## Optional\n${legal.map(link).join("\n")}`);
  return `${sections.join("\n\n")}\n`;
}
