/**
 * update-database.js
 * ---------------------------------------------------------
 * Erzeugt data/birthdays.json neu:
 *  - Für jeden der 366 Tage im Jahr werden über die deutsche
 *    Wikipedia "On this day"-API alle Personen abgerufen, die
 *    an diesem Tag (unabhängig vom Jahr) geboren wurden.
 *  - Für jede Person wird zusätzlich die Abrufzahl des
 *    deutschen Wikipedia-Artikels der letzten 30 Tage geholt
 *    und als Näherungswert für "Bekanntheit in Deutschland"
 *    verwendet.
 *  - Ergebnis wird nach Bekanntheit absteigend sortiert und
 *    als JSON gespeichert.
 *
 * Läuft automatisch einmal im Monat über GitHub Actions
 * (siehe .github/workflows/monthly-update.yml), kann aber
 * auch manuell ausgeführt werden:
 *
 *   node scripts/update-database.js
 *
 * Benötigt Node.js 18+ (für globales fetch).
 * ---------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const USER_AGENT =
  "GeburtstagsApp/1.0 (privates Hobbyprojekt; kontakt: github-actions-bot)";

const OUTPUT_PATH = path.join(__dirname, "..", "data", "birthdays.json");
const PROGRESS_PATH = path.join(__dirname, "..", "data", ".progress.json");

// Anzahl gleichzeitiger Anfragen an die Pageviews-API (höflich bleiben)
const CONCURRENCY = 6;
// Kurze Pause zwischen einzelnen Anfragen-Batches (ms)
const BATCH_DELAY_MS = 150;
// Pause zwischen den 366 Tages-Anfragen (ms) – verhindert Rate-Limiting
const DAY_DELAY_MS = 400;
// Maximale Anzahl Personen pro Tag, für die wir Pageviews abfragen
// (mehr als das bringt selten zusätzliche Erkenntnisse, spart aber viele Requests)
const MAX_PEOPLE_PER_DAY = 120;

function pad(n) {
  return String(n).padStart(2, "0");
}

// Anzahl Tage pro Monat (Februar mit 29 Tagen, damit auch der 29.2. erfasst wird)
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Robustes Abrufen mit exponentiellem Backoff. Beachtet den
// "Retry-After"-Header bei 429 (Too Many Requests) und versucht es
// deutlich öfter/länger als früher, statt schnell aufzugeben und
// stillschweigend eine leere Liste zurückzugeben.
async function fetchJson(url, retries = 6) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (res.status === 404) return null;

      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10);
        const wait = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
        console.warn(`  ! Rate-Limit (${res.status}) bei Versuch ${attempt}/${retries}, warte ${wait}ms…`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`  ! Endgültig fehlgeschlagen (${retries}x): ${url} -> ${err.message}`);
        return null;
      }
      await sleep(1000 * Math.pow(2, attempt)); // 2s, 4s, 8s, 16s, 32s …
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Holt die Geburtstagsliste eines Tages von der deutschen Wikipedia.
// Da praktisch jeder Kalendertag zahlreiche bekannte Geburtstage hat,
// gilt ein leeres Ergebnis als verdächtig und wird zusätzlich zu den
// Wiederholungsversuchen in fetchJson noch einmal komplett neu versucht.
async function fetchBirthsForDay(month, day) {
  const url = `https://api.wikimedia.org/feed/v1/wikipedia/de/onthisday/births/${pad(
    month
  )}/${pad(day)}`;

  for (let round = 1; round <= 2; round++) {
    const data = await fetchJson(url);
    if (data && Array.isArray(data.births) && data.births.length > 0) {
      return data.births;
    }
    if (round < 2) {
      console.warn(`  ! Leeres Ergebnis für ${pad(month)}-${pad(day)}, versuche es erneut…`);
      await sleep(3000);
    }
  }
  return [];
}

// Holt die Abrufzahlen der letzten 30 Tage für einen Wikipedia-Artikel
async function fetchPageviews(articleTitle) {
  const end = new Date();
  end.setDate(end.getDate() - 2); // Pageviews-API braucht ein paar Tage Vorlauf
  const start = new Date(end);
  start.setDate(start.getDate() - 30);

  const fmt = (d) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

  const encoded = encodeURIComponent(articleTitle.replace(/ /g, "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/de.wikipedia/all-access/all-agents/${encoded}/daily/${fmt(
    start
  )}/${fmt(end)}`;

  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.items)) return 0;
  return data.items.reduce((sum, item) => sum + (item.views || 0), 0);
}

// Verarbeitet eine Liste von Aufgaben mit begrenzter Parallelität
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
      await sleep(BATCH_DELAY_MS / limit);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function truncate(text, max = 220) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

async function processDay(month, day) {
  const key = `${pad(month)}-${pad(day)}`;
  const births = await fetchBirthsForDay(month, day);

  // Dedupliziere nach Seitentitel, bereite Grunddaten auf
  const people = [];
  const seen = new Set();
  for (const entry of births) {
    const page = entry.pages && entry.pages[0];
    if (!page || !page.titles || !page.titles.canonical) continue;
    const title = page.titles.canonical;
    if (seen.has(title)) continue;
    seen.add(title);
    people.push({
      name: page.displaytitle
        ? page.displaytitle.replace(/<[^>]+>/g, "")
        : page.title,
      year: entry.year,
      description: truncate(page.extract),
      thumbnail: page.thumbnail ? page.thumbnail.source : null,
      wikipediaUrl:
        (page.content_urls &&
          page.content_urls.desktop &&
          page.content_urls.desktop.page) ||
        `https://de.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      _articleTitle: title,
    });
  }

  // Begrenzen, um die Pageviews-API nicht zu überlasten
  const subset = people.slice(0, MAX_PEOPLE_PER_DAY);

  const withViews = await mapWithConcurrency(subset, CONCURRENCY, async (p) => {
    const views = await fetchPageviews(p._articleTitle);
    return { ...p, pageviews30d: views };
  });

  // Rest (falls gekappt) ohne Pageviews anhängen, ans Ende sortiert
  const rest = people.slice(MAX_PEOPLE_PER_DAY).map((p) => ({
    ...p,
    pageviews30d: 0,
  }));

  const all = [...withViews, ...rest]
    .map(({ _articleTitle, ...rest }) => rest)
    .sort((a, b) => b.pageviews30d - a.pageviews30d);

  return { key, people: all };
}

async function main() {
  console.log("Starte Aktualisierung der Geburtstags-Datenbank…");

  let database = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      database = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
    } catch {
      database = {};
    }
  }

  let processedDays = new Set();
  if (fs.existsSync(PROGRESS_PATH)) {
    try {
      processedDays = new Set(
        JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")).done || []
      );
    } catch {
      processedDays = new Set();
    }
  }

  for (let month = 1; month <= 12; month++) {
    const daysThisMonth = DAYS_IN_MONTH[month - 1];
    for (let day = 1; day <= daysThisMonth; day++) {
      const key = `${pad(month)}-${pad(day)}`;
      if (processedDays.has(key)) {
        console.log(`- ${key}: bereits erledigt, überspringe`);
        continue;
      }
      process.stdout.write(`- ${key}: lade… `);
      try {
        const { people } = await processDay(month, day);
        database[key] = people;
        processedDays.add(key);
        console.log(`${people.length} Personen`);
      } catch (err) {
        console.log(`Fehler: ${err.message}`);
      }

      // Fortschritt regelmäßig zwischenspeichern, falls der Job
      // (z. B. durch ein Zeitlimit) unterbrochen wird
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(database));
      fs.writeFileSync(
        PROGRESS_PATH,
        JSON.stringify({ done: Array.from(processedDays) })
      );

      // Kurze Pause vor dem nächsten Tag, um die Wikipedia-API nicht zu überlasten
      await sleep(DAY_DELAY_MS);
    }
  }

  console.log("Fertig! Datenbank gespeichert unter", OUTPUT_PATH);

  // Fortschrittsdatei nach vollständigem Lauf entfernen
  if (fs.existsSync(PROGRESS_PATH)) fs.unlinkSync(PROGRESS_PATH);
}

main().catch((err) => {
  console.error("Abbruch wegen Fehler:", err);
  process.exit(1);
});
