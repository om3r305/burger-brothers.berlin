import type { Metadata } from "next";
import { siteConfig } from "@/config/site.config";

export const metadata: Metadata = {
  title: "Daten löschen | Burger Brothers Berlin",
  description:
    "Informationen zur Löschung personenbezogener Daten bei Burger Brothers Berlin.",
  robots: { index: true, follow: true },
};

export default function DatenLoeschenPage() {
  const operator =
    String(process.env.LEGAL_OPERATOR_NAME || "").trim() ||
    siteConfig.brand.name;
  const privacyEmail =
    String(process.env.LEGAL_PRIVACY_EMAIL || "").trim() ||
    siteConfig.contact.email;

  const deletionSubject = "Löschung personenbezogener Daten";
  const mailto = `mailto:${privacyEmail}?subject=${encodeURIComponent(
    deletionSubject,
  )}`;

  return (
    <article className="mx-auto max-w-3xl px-5 py-12 text-stone-300">
      <h1 className="text-3xl font-bold text-white">
        Löschung personenbezogener Daten
      </h1>
      <p className="mt-4 text-sm">Burger Brothers Berlin</p>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">Verantwortlicher</h2>
        <p>
          {operator}
          <br />
          {siteConfig.contact.address}
          <br />
          <a className="underline" href={`mailto:${privacyEmail}`}>
            {privacyEmail}
          </a>
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          So können Sie die Löschung beantragen
        </h2>
        <p>
          Die Burger-Brothers-Berlin-App erfordert kein Kundenkonto. Sie können
          trotzdem jederzeit die Löschung oder Anonymisierung Ihrer bei uns
          gespeicherten personenbezogenen Daten beantragen.
        </p>
        <ol className="list-decimal space-y-2 pl-6">
          <li>
            Senden Sie eine E-Mail an{" "}
            <a className="underline" href={mailto}>
              {privacyEmail}
            </a>{" "}
            mit dem Betreff „{deletionSubject}“.
          </li>
          <li>
            Geben Sie nur die Angaben an, die wir benötigen, um Ihre Daten
            eindeutig zuzuordnen, zum Beispiel die bei einer Bestellung
            verwendete Telefonnummer oder Bestellnummer.
          </li>
          <li>
            Wir prüfen Ihre Anfrage und löschen oder anonymisieren die Daten,
            soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen.
          </li>
        </ol>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Welche Daten werden gelöscht oder anonymisiert?
        </h2>
        <p>
          Je nach Nutzung können insbesondere Kontakt-, Adress- und
          Bestelldaten betroffen sein. Vollständige Kartendaten werden nicht in
          unserer Anwendung gespeichert; Online-Zahlungen werden über Stripe
          verarbeitet.
        </p>
        <p>
          Vollständige Kontaktdaten in abgeschlossenen Bestellungen werden
          standardmäßig nach 90 Tagen anonymisiert. Kundenstammdaten ohne aktive
          Einwilligung werden standardmäßig nach 365 Tagen anonymisiert.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Gesetzliche Aufbewahrungspflichten
        </h2>
        <p>
          Daten, die wir aufgrund gesetzlicher Aufbewahrungspflichten weiterhin
          speichern müssen, werden nicht vor Ablauf der jeweiligen gesetzlichen
          Frist gelöscht. Diese Daten werden nur für die gesetzlich vorgesehenen
          Zwecke weiterverarbeitet.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Weitere Informationen
        </h2>
        <p>
          Weitere Einzelheiten zur Verarbeitung personenbezogener Daten finden
          Sie in unserer{" "}
          <a className="underline" href="/datenschutz">
            Datenschutzerklärung
          </a>
          .
        </p>
      </section>
    </article>
  );
}
