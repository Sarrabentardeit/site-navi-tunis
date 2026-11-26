/** Types partagés du noyau Navi-SEO Core. Aucune dépendance à Next.js. */

export interface ServiceFamily {
  readonly name: string;
  readonly tagline: string;
  readonly offerings: readonly string[];
}

/** Données d'entreprise d'un site. Fournie par l'appelant, jamais lue dans l'environnement. */
export interface SiteConfig {
  readonly name: string;
  readonly legalName: string;
  /** URL canonique sans slash final. */
  readonly url: string;
  readonly locale: string;
  readonly language: string;
  readonly tagline: string;
  readonly description: string;
  readonly logoPath: string;
  readonly defaultOgImage: string;
  readonly googleSiteVerification?: string;
  readonly contact: { readonly email: string; readonly telephone: string };
  readonly address: {
    readonly streetAddress: string;
    readonly addressLocality: string;
    readonly postalCode: string;
    readonly addressCountry: string;
  };
  readonly areaServed: readonly string[];
  readonly sameAs: readonly string[];
  readonly twitterHandle?: string;
  readonly brand: { readonly navy: string; readonly cyan: string; readonly red: string };
  readonly serviceFamilies: readonly ServiceFamily[];
}

export type PageType = "home" | "service" | "case-study" | "article" | "page" | "legal";
export type ChangeFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface PageEntry {
  /** Chemin sans slash final (ex. "/odoo"). */
  readonly path: string;
  readonly type: PageType;
  readonly title: string;
  readonly description: string;
  readonly section?: string;
  /** Date ISO. N'indiquer que si elle est réelle. */
  readonly lastModified?: string;
  readonly datePublished?: string;
  readonly priority?: number;
  readonly changeFrequency?: ChangeFrequency;
  readonly noindex?: boolean;
  readonly ogImage?: string;
  readonly keywords?: readonly string[];
  readonly breadcrumbLabel?: string;
}

export interface NewsItem {
  readonly path: string;
  readonly title: string;
  readonly publishedAt: string;
}

export interface VideoItem {
  readonly pagePath: string;
  readonly title: string;
  readonly description: string;
  readonly thumbnailUrl: string;
  readonly contentUrl?: string;
  readonly playerUrl?: string;
  readonly duration?: number;
  readonly publishedAt?: string;
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

/** Contexte injecté dans toutes les fonctions du noyau. */
export interface SeoContext {
  readonly site: SiteConfig;
  readonly pages: readonly PageEntry[];
  readonly newsItems?: readonly NewsItem[];
  readonly videoItems?: readonly VideoItem[];
}

export type Env = Readonly<Record<string, string | undefined>>;

/** Sous-ensemble structurel de `Metadata` de Next.js (le noyau ne dépend pas de Next). */
export interface SeoMetadata {
  readonly metadataBase?: URL;
  readonly applicationName?: string;
  readonly verification?: { readonly google: string };
  readonly title: { readonly absolute: string };
  readonly description: string;
  readonly alternates: { readonly canonical: string };
  readonly robots?: { readonly index: boolean; readonly follow: boolean };
  readonly openGraph: {
    readonly type: "article" | "website";
    readonly url: string;
    readonly siteName: string;
    readonly locale: string;
    readonly title: string;
    readonly description: string;
    readonly images: readonly { readonly url: string; readonly width?: number; readonly height?: number; readonly alt: string }[];
    readonly publishedTime?: string;
  };
  readonly twitter: {
    readonly card: "summary_large_image";
    readonly title: string;
    readonly description: string;
    readonly images: readonly string[];
    readonly site?: string;
  };
}

export interface RobotsRule {
  readonly userAgent: string | readonly string[];
  readonly allow?: string | readonly string[];
  readonly disallow?: string | readonly string[];
}
export interface RobotsConfig {
  readonly rules: readonly RobotsRule[];
  readonly sitemap?: readonly string[];
  readonly host?: string;
}
