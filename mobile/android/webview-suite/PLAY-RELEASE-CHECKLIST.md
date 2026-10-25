# Play release checklist - 2026-10-25

## Prepared locally

- Existing package IDs retained. Candidate version codes customer 7, Driver 2, Schnell 4 exceed observed Play maxima 6/1/3.
- Existing upload keys referenced, no key generation/rotation. Recompare current Play upload certificate before signed submission; verify Play app-signing/rotation fingerprints separately for App Links.
- Release debug disabled; HTTPS only; FCM on all three apps; location foreground service only Driver; no unrestricted background-location permission.
- German factual privacy disclosure drafted in `/datenschutz`; store Data Safety and permission declarations need owner review against the actual deployed behavior and service agreements. No policy forms were submitted.

## Required before upload/rollout

1. Supply the missing FCM JSON through a local file path. Validate credentials without printing them. Configure a test/preview server securely, then test one device per flavor: permission grant/deny, foreground/background delivery, notification tap and token refresh. Do not send marketing campaigns or real kitchen orders.
2. Deploy the compatible web branch to a controlled preview and validate native bridge/API integration, Schnell entry/install/menu, QR access, authenticated Driver session and notification subscription. Production rollout requires approval.
3. Run signing script with local secure password prompts; verify each signed AAB certificate, package and code. No passwords in chat.
4. On a physical phone using the intended Play internal-track installation: cold/warm launch, no Chrome disclosure, location and notification permissions grant/deny, Driver screen-off delivery and Stopp/logout/route-end, reboot without silent tracking, app update preserving account/cart where applicable.
5. At 360x640, 360x800 and 390x844: product/options/cart, Abholung/Lieferung, address/phone keyboard and lower actions, open/close/back, body scroll recovery. Browser/CDP measurements do not replace physical keyboard testing.
6. In a controlled payment environment validate checkout/3DS/external-browser return with all three apps installed. No real payments or live orders. Do not change business pause/hours/payment settings to enable testing.
7. Review Data Safety declarations: FCM installation/token identifiers, delivery metadata; Driver precise/approximate location during active deliveries and foreground-service declaration/evidence video where requested. Match actual existing app data collection too; this checklist is not a completed legal review.
8. Internal testing/pre-launch report, final owner approval, then production rollout. Nothing has been uploaded or published in this work.

## Draft German release notes

Customer: Die Android-App startet mit integrierter Ansicht. Bestellfenster passen sich besser an kleine Bildschirme an. Benachrichtigungen werden direkt durch Android zugestellt.

Driver: Android-Benachrichtigungen fuer Lieferungen und Live-Standort waehrend aktiver Fahrten, mit sichtbarer Statusmeldung und Stopp-Funktion.

Schnell: Verbesserter Start der installierten Android-App und Benachrichtigung bei abholbereiten Bestellungen.

Use these notes only after the corresponding flows pass release validation.
