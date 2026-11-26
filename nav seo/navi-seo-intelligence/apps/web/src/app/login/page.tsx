import { loginAction } from "./actions";

const MESSAGES: Record<string, string> = {
  invalid: "Identifiants invalides.",
  totp: "Saisissez le code à 6 chiffres de votre application d'authentification.",
  rate: "Trop de tentatives. Réessayez dans quelques minutes.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }): Promise<React.JSX.Element> {
  const { error } = await searchParams;
  return (
    <div className="login card">
      <h1>Navi-SEO Intelligence</h1>
      {error && <p className={error === "totp" ? "warn" : "err"}>{MESSAGES[error] ?? MESSAGES.invalid}</p>}
      <form action={loginAction}>
        <input name="email" type="email" placeholder="E-mail" autoComplete="username" required />
        <input name="password" type="password" placeholder="Mot de passe" autoComplete="current-password" required />
        <input name="totp" inputMode="numeric" pattern="[0-9 ]*" placeholder="Code à 6 chiffres (si activé)" autoComplete="one-time-code" />
        <button type="submit">Se connecter</button>
      </form>
    </div>
  );
}
