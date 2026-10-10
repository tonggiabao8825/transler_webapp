import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type JSX } from "react";
import { AccountApi } from "../../shared/api/account-api";
import { LanguagePicker } from "../../shared/i18n/LanguagePicker";
import { useTranslation } from "../../shared/i18n/i18n";
type Props = {
  api: AccountApi;
  mode: "login" | "register";
  onMode: (mode: "login" | "register") => void;
  onAuthenticated: () => Promise<void>;
};
export function AuthScreen({
  api,
  mode,
  onMode,
  onAuthenticated,
}: Props): JSX.Element {
  const { t } = useTranslation();

  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email"));
    const password = String(values.get("password"));
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        if (password !== String(values.get("confirm")))
          throw new Error("Passwords must match.");
        await api.register(String(values.get("name")), email, password);
      } else await api.login(email, password);
      await onAuthenticated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-layout" data-testid="auth-screen">
      <div className="auth-story">
        <LanguagePicker />
        <img src="/assets/brand/logo-symbol.svg" alt="" width="40" />
        <h1>
          {t("Your documents.")} <br />
          {t("Every language.")}{" "}
        </h1>
        <p>
          {t(
            "Keep your original layout, translation history and files together in your private Transler library.",
          )}{" "}
        </p>
        <div className="auth-benefit">
          <ShieldCheck size={18} />{" "}
          {t("Private library · Original layout preserved")}{" "}
        </div>
        <img
          className="auth-mascot"
          src="/assets/mascot/explaining.svg"
          alt="Transler document assistant"
        />
      </div>
      <div className="panel auth-form">
        <div
          className="account-tabs"
          role="group"
          aria-label={t("Authentication")}
        >
          <button
            data-testid="auth-login-tab"
            aria-pressed={mode === "login"}
            onClick={() => {
              onMode("login");
              setError(null);
            }}
          >
            {t("Sign in")}{" "}
          </button>
          <button
            data-testid="auth-register-tab"
            aria-pressed={mode === "register"}
            onClick={() => {
              onMode("register");
              setError(null);
            }}
          >
            {t("Create account")}{" "}
          </button>
        </div>
        <h2>
          {mode === "login" ? t("Welcome back") : t("Create your account")}
        </h2>
        <p>
          {mode === "register"
            ? t("Your current guest documents will stay with this account.")
            : t("Sign in to open your saved documents.")}
        </p>
        {error && (
          <p className="account-error" role="alert" data-testid="auth-error">
            {error}
          </p>
        )}
        <form onSubmit={(event) => void submit(event)}>
          {mode === "register" && (
            <label>
              {t("Name")}{" "}
              <input
                name="name"
                data-testid="auth-name"
                autoComplete="name"
                required
                maxLength={80}
              />
            </label>
          )}
          <label>
            {t("Email")}{" "}
            <input
              name="email"
              data-testid="auth-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            {t("Password")}{" "}
            <span className="password-field">
              <input
                name="password"
                data-testid="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
                minLength={mode === "register" ? 12 : 1}
                maxLength={128}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={
                  showPassword ? t("Hide password") : t("Show password")
                }
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          {mode === "register" && (
            <label>
              {t("Confirm password")}{" "}
              <input
                name="confirm"
                data-testid="auth-confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
              <small>{t("Use at least 12 characters.")} </small>
            </label>
          )}
          <button
            className="button primary"
            data-testid="auth-submit"
            disabled={busy}
          >
            {busy
              ? t("Please wait…")
              : mode === "login"
                ? t("Sign in")
                : t("Create account")}{" "}
            <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </section>
  );
}
