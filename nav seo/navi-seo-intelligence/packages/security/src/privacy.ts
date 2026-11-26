import { createHmac } from "node:crypto";

/** Empreinte HMAC d'une IP (journal d'audit). Avec un sel secret, l'IP n'est pas retrouvable par énumération. */
export const hashIp = (ip: string, secret: string): Buffer => createHmac("sha256", secret).update(ip).digest();
