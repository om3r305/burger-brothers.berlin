import type { Metadata } from "next";
import { siteConfig } from "@/config/site.config";

export const metadata: Metadata = {
  title: "Impressum | Burger Brothers Berlin",
  robots: { index: true, follow: true },
};

export default function ImpressumPage() {
  const operator =
    String(process.env.LEGAL_OPERATOR_NAME || "").trim() ||
    siteConfig.brand.name;
  const responsible = String(
    process.env.LEGAL_RESPONSIBLE_NAME || "",
  ).trim();
  const vatId = String(process.env.LEGAL_VAT_ID || "").trim();
  const register = String(process.env.LEGAL_REGISTER_ENTRY || "").trim();

  return (
    <article className="mx-auto max-w-3xl px-5 py-12 text-stone-200">
      <h1 className="text-3xl font-bold text-white">Impressum</h1>
      <section className="mt-8 space-y-2">
        <h2 className="text-xl font-semibold text-white">
          Angaben gemäß § 5 DDG
        </h2>
        <p>{operator}</p>
        <p>{siteConfig.contact.address}</p>
        {responsible ? <p>Vertreten durch: {responsible}</p> : null}
        {register ? <p>Registereintrag: {register}</p> : null}
        {vatId ? (
          <p>Umsatzsteuer-Identifikationsnummer: {vatId}</p>
        ) : null}
      </section>
      <section className="mt-8 space-y-2">
        <h2 className="text-xl font-semibold text-white">Kontakt</h2>
        <p>
          Telefon:{" "}
          <a className="underline" href={`tel:${siteConfig.contact.phone}`}>
            {siteConfig.contact.phone}
          </a>
        </p>
        <p>
          E-Mail:{" "}
          <a className="underline" href={`mailto:${siteConfig.contact.email}`}>
            {siteConfig.contact.email}
          </a>
        </p>
      </section>
      <section className="mt-8 space-y-2">
        <h2 className="text-xl font-semibold text-white">
          Verbraucherstreitbeilegung
        </h2>
        <p>
          Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren
          vor einer Verbraucherschlichtungsstelle teilzunehmen, sofern keine
          gesetzliche Verpflichtung besteht.
        </p>
      </section>
    </article>
  );
}
