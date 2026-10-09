import { LanguagePicker } from "./LanguagePicker";
import { useTranslation } from "./i18n";
import type { JSX } from "react";
import { ArrowRight, Play, ShieldCheck, Check, Sparkles } from "lucide-react";
type LandingProps = {
  onStart: () => void;
  authenticated: boolean;
  ready: boolean;
  onPlanned: (feature: string) => void;
};
export function Landing({
  onStart,
  onPlanned,
  authenticated,
  ready,
}: LandingProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="landing" data-testid="landing-screen">
      <header className="landing-nav">
        <a className="brand" href="/">
          <img src="/assets/brand/logo-symbol.svg" alt="" />
          <span>Transler.</span>
        </a>
        <nav aria-label={t("Website")}>
          <a href="#products">{t("Products")} </a>
          <button onClick={() => onPlanned("Pro plans")}>
            {t("Pricing")}{" "}
          </button>
          <a href="/openapi.json">{t("Docs")} </a>
          <button onClick={() => onPlanned("Transler blog")}>
            {t("Blog")}{" "}
          </button>
        </nav>
        <div>
          <LanguagePicker />
          {ready && !authenticated && (
            <button
              className="button secondary"
              data-testid="landing-login"
              onClick={() => onPlanned("Sign in")}
            >
              {t("Sign in")}{" "}
            </button>
          )}
          <button
            className="button dark"
            disabled={!ready}
            data-testid="landing-start"
            onClick={onStart}
          >
            {authenticated ? t("Go to dashboard") : t("Get started")}
          </button>
        </div>
      </header>
      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-tag">
            <Sparkles size={13} />
            {t("AI-Powered Document Translation")}{" "}
          </span>
          <h1>
            {t("Translate any document,")} <br />
            {t("keep the original layout.")}{" "}
          </h1>
          <h2>{t("Accurate. Beautiful. Effortless.")} </h2>
          <p>
            {t(
              "Transler helps you translate, edit, and convert documents with AI while preserving the original format. Start with PDF translation, right in your browser.",
            )}{" "}
          </p>
          <div className="landing-actions">
            <button className="button dark" onClick={onStart}>
              {authenticated ? t("Open your dashboard") : t("Get started free")}{" "}
              <ArrowRight size={16} />
            </button>
            <button
              className="button secondary"
              onClick={() => onPlanned("Product walkthrough")}
            >
              {t("Watch video")} <Play size={14} />
            </button>
          </div>
          <div className="landing-trust">
            <ShieldCheck size={22} />
            <span>
              <strong>{t("Made for your documents")} </strong>
              <small>{t("Private by default · No account needed")} </small>
            </span>
          </div>
        </div>
        <div className="landing-art">
          <div className="art-orb" />
          <div className="floating-document document-back">
            <span />
            <span />
            <span />
            <span />
            <img src="/assets/file-types/docx.svg" alt="Word document" />
          </div>
          <div className="floating-document document-front">
            <img src="/assets/file-types/pdf.svg" alt="PDF document" />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <img
            className="landing-mascot"
            src="/assets/mascot/holding-document.svg"
            alt="Transler robot holding a document"
          />
          <img
            className="landing-plane"
            src="/assets/decorations/paper-plane.svg"
            alt=""
          />
          <img
            className="float-xlsx"
            src="/assets/file-types/xlsx.svg"
            alt="Excel"
          />
          <img
            className="float-pptx"
            src="/assets/file-types/pptx.svg"
            alt="PowerPoint"
          />
          <div className="language-chips">
            <img src="/assets/languages/english.svg" alt="English" />
            <ArrowRight size={17} />
            <img src="/assets/languages/vietnamese.svg" alt="Vietnamese" />
          </div>
          <p className="handwritten">
            {t("Keep original")} <br />
            {t("layout ↗")}{" "}
          </p>
        </div>
      </section>
      <section className="landing-products" id="products">
        <h2>{t("One workspace. More possibilities.")} </h2>
        <p>
          {t(
            "Translate, edit, convert and organize your documents in one private workspace.",
          )}{" "}
        </p>
        <div>
          {["Translate PDF", "Edit PDF", "Convert files", "Searchable OCR"].map(
            (item) => (
              <article key={item}>
                <Check size={18} />
                <strong>{item}</strong>
              </article>
            ),
          )}
        </div>
      </section>
      <section className="landing-pricing" id="pricing">
        <h2>{t("A free place to start.")} </h2>
        <p>
          {t(
            "Native-text PDFs · Up to 30 pages · Original and translated files · 7-day history",
          )}{" "}
        </p>
        <button className="button primary" onClick={onStart}>
          {t("Open your workspace")}{" "}
        </button>
      </section>
      <footer>
        {t("Transler · Made for understanding.")}{" "}
        <a href="/openapi.json">{t("API documentation ↗")} </a>
      </footer>
    </div>
  );
}
