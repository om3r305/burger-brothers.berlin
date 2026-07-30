import type { Metadata } from "next";
import { siteConfig } from "@/config/site.config";

export const metadata: Metadata = {
  title: "Datenschutz | Burger Brothers Berlin",
  robots: { index: true, follow: true },
};

export default function DatenschutzPage() {
  const operator =
    String(process.env.LEGAL_OPERATOR_NAME || "").trim() ||
    siteConfig.brand.name;
  const privacyEmail =
    String(process.env.LEGAL_PRIVACY_EMAIL || "").trim() ||
    siteConfig.contact.email;

  return (
    <article className="mx-auto max-w-3xl px-5 py-12 text-stone-300">
      <h1 className="text-3xl font-bold text-white">Datenschutzerklärung</h1>
      <p className="mt-4 text-sm">Stand: 30. Juli 2026</p>

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
          Bestellung und Kundenservice
        </h2>
        <p>
          Für Bestellung, Lieferung, Abholung, Zahlung und Rückfragen verarbeiten
          wir die von Ihnen eingegebenen Kontakt-, Adress-, Bestell- und
          Zahlungsstatusdaten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO;
          gesetzlich aufzubewahrende Abrechnungsdaten verarbeiten wir nach Art. 6
          Abs. 1 lit. c DSGVO. Vollständige Kontaktdaten in abgeschlossenen
          Bestellungen werden standardmäßig nach 90 Tagen anonymisiert.
          Kundenstammdaten ohne aktive Einwilligung werden standardmäßig nach 365
          Tagen anonymisiert. Gesetzliche Aufbewahrungspflichten bleiben
          unberührt.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Zahlung, Hosting und Dienstleister
        </h2>
        <p>
          Online-Zahlungen werden über Stripe verarbeitet; vollständige
          Kartendaten werden nicht in unserer Anwendung gespeichert. Für Hosting,
          Datenbank, verschlüsselte Sicherungen, optionale Medien und
          Benachrichtigungen können Vercel, Supabase, Cloudinary, Cloudflare R2
          und Telegram eingesetzt werden. Es gelten die jeweils
          konfigurierten Auftragsverarbeitungs- und Übermittlungsregelungen.
        </p>
      </section>

      <section id="analytics" className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Freiwillige Reichweitenmessung
        </h2>
        <p>
          Statistik wird erst nach Ihrer ausdrücklichen Auswahl aktiviert. Wir
          speichern nur erlaubte Ereignisnamen, den Seitenpfad ohne
          Suchparameter, eine täglich wechselnd gehashte Sitzungskennung und
          stark begrenzte Ereigniseigenschaften. Roh-IP-Adresse, vollständiger
          User-Agent und die ursprüngliche Sitzungskennung werden nicht
          gespeichert. Ereignisse werden standardmäßig nach 30 Tagen gelöscht.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. a DSGVO. Die Einwilligung kann
          jederzeit über „Statistik-Einstellung“ im Footer geändert werden.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">
          Standort, Push und Gewinnfoto
        </h2>
        <p>
          Standortdaten werden nur für ausdrücklich gestartete
          Liefer-/Schnellbestellfunktionen verarbeitet und nach kurzer
          Aufbewahrungsfrist gelöscht. Push-Benachrichtigungen und die zeitweise
          Anzeige eines Gewinnfotos sind freiwillig und erfordern eine eigene
          Einwilligung. Berechtigungen können im Browser oder Betriebssystem
          widerrufen werden.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-white">Ihre Rechte</h2>
        <p>
          Sie haben im gesetzlichen Umfang Rechte auf Auskunft, Berichtigung,
          Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch sowie das
          Recht, eine Einwilligung mit Wirkung für die Zukunft zu widerrufen.
          Außerdem können Sie sich bei einer Datenschutzaufsichtsbehörde
          beschweren. Anfragen senden Sie an die oben genannte E-Mail-Adresse.
        </p>
      </section>
    </article>
  );
}
