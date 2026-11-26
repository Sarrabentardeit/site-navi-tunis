/** Sous-export `@navi/core/next` : plugin de config et composants Next.js. Dépendances `next` et `react` : celles du site appelant. */
export { withNaviSeo, type NextConfigLike } from "./plugin";
export { JsonLd, PageJsonLd } from "./JsonLd";
export { SmartImage, type SmartImageProps } from "./SmartImage";
export { Log404Beacon } from "./Log404Beacon";
export { renderOgImage, OG_SIZE } from "./og";
