import { decryptCredentials, otpauthUri } from "@navi/security";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { confirmTotpAction, startTotpAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ pending?: string; error?: string }> }): Promise<React.JSX.Element> {
  const s = await requireSession();
  const { pending, error } = await searchParams;
  let secret: string | undefined;
  if (pending) {
    const [v, b64] = pending.split(".");
    try {
      secret = decryptCredentials(Buffer.from(b64 ?? "", "base64url"), Number(v), getEnv().ring, `user:${s.sub}|totp-pending`);
    } catch {
      secret = undefined;
    }
  }
  return (
    <>
      <h1>Sécurité du compte</h1>
      <p>Authentification à deux facteurs : {s.mfa ? <span className="ok">activée pour cette session</span> : <span className="warn">non validée pour cette session</span>}</p>
      {error && <p className="err">{error === "code" ? "Code incorrect." : "Demande expirée, recommencez."}</p>}
      {!secret ? (
        <form action={startTotpAction}><button type="submit">Configurer une application d&apos;authentification</button></form>
      ) : (
        <div className="card">
          <p>Ajoutez ce compte dans votre application (saisie manuelle de la clé) :</p>
          <p><code>{secret}</code></p>
          <p className="muted">URI : <code>{otpauthUri(secret, s.sub)}</code></p>
          <form className="inline" action={confirmTotpAction}>
            <input type="hidden" name="pending" value={pending} />
            <input name="code" inputMode="numeric" placeholder="Code à 6 chiffres" required />
            <button type="submit">Confirmer</button>
          </form>
        </div>
      )}
    </>
  );
}
