# Wer hat heute Geburtstag?

Mobile Web-App: Datum sprechen (oder auswählen) → sofortige Liste aller
weltweit an diesem Tag geborenen Prominenten, sortiert nach Bekanntheit
in Deutschland (Abrufzahlen der deutschen Wikipedia der letzten 30 Tage).

Die Daten liegen **vorab berechnet** in `data/birthdays.json`, damit die
App beim Absuchen keine Wartezeit hat. Diese Datei wird **automatisch
einmal im Monat** über GitHub Actions neu erzeugt.

## Einrichtung (einmalig)

1. **Neues GitHub-Repository erstellen** (z. B. `geburtstag-app`), diese
   Dateien hochladen (oder das Repo klonen und die Dateien reinkopieren
   und pushen).

2. **GitHub Pages aktivieren:**
   Repo → *Settings* → *Pages* → unter *Build and deployment* die Quelle
   auf **„GitHub Actions“** oder **„Deploy from a branch“ → `main` /
   `root`** stellen. Nach ein bis zwei Minuten ist die App unter
   `https://<dein-username>.github.io/<repo-name>/` erreichbar.

3. **Ersten Datenbank-Lauf manuell starten** (nicht einen Monat warten):
   Repo → Tab *Actions* → Workflow **„Monatliche Aktualisierung der
   Geburtstags-Datenbank“** auswählen → **„Run workflow“** klicken.
   Der Lauf dauert je nach Wikipedia-Antwortzeiten ca. 30–90 Minuten,
   da für alle 366 Tage Daten geholt werden. Danach ist `data/birthdays.json`
   automatisch mit echten Daten befüllt und committed.

4. Ab jetzt läuft der Workflow **automatisch am 1. jedes Monats** und
   aktualisiert die Datenbank ohne dein Zutun. Du kannst ihn jederzeit
   auch manuell erneut über „Run workflow“ anstoßen.

## Nutzung

- App auf dem Handy öffnen (am besten Chrome/Android für Spracherkennung;
  auf iPhone/Safari funktioniert die manuelle Datumsauswahl als Fallback).
- Mikrofon antippen und z. B. „10. März“ oder „heute“ sagen – oder das
  Datum unten manuell wählen und auf „Los“ tippen.
- Ergebnisliste erscheint sofort aus der lokal geladenen Datenbank.

## Hinweise

- „Bekanntheit in Deutschland“ ist ein Näherungswert (Wikipedia-Abrufzahlen),
  keine offizielle Rangliste.
- `data/birthdays.json` enthält aktuell nur wenige Platzhalter-Einträge zum
  Testen der App-Optik. Nach dem ersten Workflow-Lauf (Schritt 3 oben) wird
  sie durch die vollständige, echte Datenbank ersetzt.
- Das Update-Skript (`scripts/update-database.js`) kann auch lokal mit
  Node.js 18+ ausgeführt werden: `node scripts/update-database.js`
