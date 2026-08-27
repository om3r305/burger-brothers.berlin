import type { Metadata } from "next";
import { siteConfig } from "@/config/site.config";

export const metadata: Metadata = {
  title: "Support | Burger Brothers Berlin",
  description:
    "Hilfe und Kontakt für die Burger Brothers Berlin App, Bestellungen, Lieferung und Abholung.",
  robots: { index: true, follow: true },
};

export default function SupportPage() {
  const supportEmail = siteConfig.contact.email;
  const supportPhone = siteConfig.contact.phone;
  const mailto = `mailto:${supportEmail}?subject=${encodeURIComponent(
    "Support – Burger Brothers Berlin App",
  )}`;
  const tel = `tel:${supportPhone.replace(/\s+/g, "")}`;

  return (
    <article className="mx-auto max-w-3xl px-5 py-12 text-stone-300">
      <h1 className="text-3xl font-bold text-white">Burger Brothers Support</h1>
      <p className="mt-4 text-base leading-7">
        Hilfe zur Burger Brothers Berlin App sowie zu Bestellungen, Lieferung
        und Abholung.
      </p>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">Kontakt</h2>
        <p>
          E-Mail:{" "}
          <a className="underline" href={mailto}>
            {supportEmail}
          </a>
          <br />
          Telefon:{" "}
          <a className="underline" href={tel}>
            {supportPhone}
          </a>
          <br />
          Adresse: {siteConfig.contact.address}
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Hilfe bei einer Bestellung
        </h2>
        <p>
          Wenn Sie Fragen zu einer Bestellung, Lieferung, Abholung oder Zahlung
          haben, kontaktieren Sie uns bitte per E-Mail oder Telefon. Falls
          vorhanden, nennen Sie Ihre Bestellnummer und die bei der Bestellung
          verwendete Telefonnummer, damit wir die Bestellung schneller zuordnen
          können.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Technische Probleme mit der App
        </h2>
        <p>
          Bei einem technischen Problem helfen uns eine kurze Beschreibung,
          das verwendete iPhone-Modell, die iOS-Version und – wenn möglich – ein
          Screenshot des Problems. Bitte senden Sie keine Passwörter,
          vollständigen Zahlungsdaten oder andere vertrauliche Zugangsdaten.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Datenschutz und Datenlöschung
        </h2>
        <p>
          Informationen zur Verarbeitung personenbezogener Daten finden Sie in
          unserer{" "}
          <a className="underline" href="/datenschutz">
            Datenschutzerklärung
          </a>
          . Wenn Sie die Löschung oder Anonymisierung Ihrer gespeicherten Daten
          beantragen möchten, finden Sie die Schritte unter{" "}
          <a className="underline" href="/daten-loeschen">
            Daten löschen
          </a>
          .
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">Burger Brothers Berlin</h2>
        <p>
          <a className="underline" href="/">
            Zurück zur Website
          </a>
        </p>
      </section>
    </article>
  );
}
