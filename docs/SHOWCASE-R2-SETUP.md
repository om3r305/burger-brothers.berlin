# Burger Brothers – Digitales Schaufenster

## Was wurde integriert?

- Öffentliche TV-Ansicht: `/showcase`
- Eigener Adminbereich: `/admin/showcase`
- Entwurf speichern und getrennt veröffentlichen
- 16:9-Live-Vorschau im Admin
- Szenen für Startseite, Video, Produkt, Kampagne, Bild, QR-Code und Text
- Produkte, Preise, Bilder, Kampagnen, aktives Theme und aktives Logo aus der bestehenden Datenbank bzw. den bestehenden Einstellungen
- Cloudflare-R2-Upload für große Videos und Bilder
- Lokaler letzter erfolgreicher Showcase-Snapshot im TV-Browser
- Vorladen der nächsten Medien-Datei
- Automatisches Überspringen bei einem fehlerhaften Video
- Muted Autoplay für Smart-TV-Browser
- Keine Prisma-Migration: Entwurf, Veröffentlichung und Medienliste werden über bestehende `Setting`-Einträge gespeichert

Die bestehenden Routen `/dashboard`, `/tv`, `/driver`, Bestellung, Bezahlung und Druck wurden nicht ersetzt.

## Empfohlene Videoqualität

- 1920 × 1080 Pixel
- MP4 / H.264
- 30 FPS
- ungefähr 6–10 Mbit/s
- Ton entfernen oder stumm lassen
- 4K nur verwenden, wenn TV und Internetverbindung es wirklich benötigen

Jede hochgeladene Datei erhält einen einmaligen Dateinamen und den Cache-Header:

```text
Cache-Control: public, max-age=31536000, immutable
```

Dadurch kann der TV-Browser bereits geladene Medien sehr lange aus seinem Cache verwenden.

## Cloudflare R2 vorbereiten

### 1. Bucket erstellen

Im Cloudflare-Dashboard unter **R2 Object Storage** einen Bucket erstellen:

```text
burger-brothers-showcase
```

### 2. Öffentliche URL aktivieren

Für den Bucket entweder die bereitgestellte öffentliche `r2.dev`-Adresse aktivieren oder später eine eigene Medien-Domain verbinden.

Beispiel:

```text
https://pub-xxxxxxxxxxxxxxxx.r2.dev
```

Nur die Basisadresse ohne abschließenden Schrägstrich wird als `R2_PUBLIC_BASE_URL` eingetragen.

### 3. CORS für den Direkt-Upload setzen

Im R2-Bucket folgende CORS-Regeln eintragen:

```json
[
  {
    "AllowedOrigins": [
      "https://www.burger-brothers.berlin",
      "http://localhost:3000"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD",
      "PUT"
    ],
    "AllowedHeaders": [
      "Content-Type",
      "Cache-Control"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

Für eine Vercel-Preview-Domain muss diese bei Bedarf zusätzlich in `AllowedOrigins` eingetragen werden.

### 4. R2 API-Zugang erstellen

Einen R2-API-Token mit **Object Read & Write** erstellen und nur auf den Showcase-Bucket beschränken.

Die Werte niemals in GitHub, eine ZIP-Datei oder Quellcode schreiben.

### 5. Vercel Environment Variables

Im Vercel-Projekt folgende Variablen für Production, Preview und Development eintragen:

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=burger-brothers-showcase
R2_PUBLIC_BASE_URL=
R2_MAX_UPLOAD_MB=750
```

Danach neu deployen.

## Bedienung

1. Admin öffnen.
2. **Schaufenster** auswählen.
3. Szenen hinzufügen und bearbeiten.
4. Video oder Bild hochladen.
5. Rechts die Live-Vorschau kontrollieren.
6. **Entwurf speichern** speichert nur den Arbeitsstand.
7. **Veröffentlichen** schaltet die Version für `/showcase` frei.
8. Am Smart TV `/showcase` öffnen und den Browser auf Vollbild stellen.

## Technischer Speicheraufbau

```text
GitHub / Vercel
  └─ Showcase-Code

Supabase PostgreSQL
  ├─ showcase:draft
  ├─ showcase:published
  └─ showcase:media

Cloudflare R2
  └─ große Videos und Bilder
```

## Tests

```powershell
npm.cmd run showcase:test
npm.cmd run typecheck
npm.cmd run build
```
