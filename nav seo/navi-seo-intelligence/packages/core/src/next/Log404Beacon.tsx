"use client";

import { useEffect } from "react";

/**
 * À placer dans app/not-found.tsx. Envoie l'URL et le referer au point de collecte 404
 * (sendBeacon, sans impact sur le rendu). Seule cette page charge du JS : le reste du site reste statique.
 */
export function Log404Beacon({ endpoint = "/api/seo/log-404" }: { endpoint?: string }): null {
  useEffect(() => {
    const body = JSON.stringify({ path: window.location.pathname, referer: document.referrer });
    navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
  }, [endpoint]);
  return null;
}
