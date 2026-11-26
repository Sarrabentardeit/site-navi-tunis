import { loadWebEnv, type WebEnv } from "@navi/config";
import { parseKeyRing, type KeyRing } from "@navi/security";

let cached: { env: WebEnv; ring: KeyRing } | undefined;

/** Chargé au premier usage (et non à l'import) pour que `next build` ne dépende pas des secrets. */
export function getEnv(): { env: WebEnv; ring: KeyRing } {
  cached ??= (() => {
    const env = loadWebEnv();
    return { env, ring: parseKeyRing(env.CREDENTIALS_KEYRING) };
  })();
  return cached;
}
