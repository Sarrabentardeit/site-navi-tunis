import Image, { type ImageProps } from "next/image";
import { generateAlt, type AltContext } from "../alt-text";

export type SmartImageProps = Omit<ImageProps, "alt"> & {
  /** Alt rédigé. `alt=""` = image décorative (respecté). Absent = alt généré automatiquement. */
  alt?: string;
  /** Contexte pour la génération (titre de page, rubrique, mots-clés). */
  altContext?: AltContext;
  /** Alts validés manuellement (clé = src). Fournis par le site, plus importés depuis un fichier de la bibliothèque. */
  altOverrides?: Readonly<Record<string, string>>;
};

function srcToString(src: ImageProps["src"]): string {
  if (typeof src === "string") return src;
  return "default" in src ? src.default.src : src.src;
}

/**
 * Wrapper de next/image : utilise le alt fourni, sinon un alt validé (image-alts.json),
 * sinon un alt généré. Server Component.
 */
export function SmartImage({ alt, altContext, altOverrides = {}, ...rest }: SmartImageProps): React.JSX.Element {
  const src = srcToString(rest.src);
  let resolved = alt;
  if (resolved === undefined) {
    resolved = altOverrides[src] ?? generateAlt(src, altContext ?? {});
    if (process.env.NODE_ENV === "development") {
      console.warn(`[navi-seo] alt automatique pour ${src} : « ${resolved} ». Rédigez un alt manuel si possible.`);
    }
  }
  return <Image {...rest} alt={resolved} />;
}
