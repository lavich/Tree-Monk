import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Code2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { API_EXAMPLES, PLUGIN_LLM_SPEC } from '@/lib/pluginLlmSpec'

/**
 * In-app technical guide for plugin AUTHORS (sidebar → Plugins → Build a
 * plugin). The prose lives here per language (hu/en/de/ru, following the app
 * language); code samples are language-neutral. PLUGINS.md in the repo is the
 * same material for people reading on GitHub.
 */

interface Section {
  title: string
  paras?: string[]
  code?: string
  table?: { head: [string, string]; rows: [string, string][] }
  list?: string[]
  /** Renders the full endpoint reference (shared rows, localized text). */
  apiRef?: boolean
}

/** Every local-API route — the descriptions are localized, the rest shared. */
const API_ROWS: { m: string; p: string; scope: string; d: Record<'hu' | 'en' | 'de' | 'ru', string> }[] = [
  { m: 'GET', p: '/api/v1/stats', scope: 'read', d: { hu: 'Fa-statisztika (fő, család, helyek, legkorábbi/legkésőbbi születési év)', en: 'Tree statistics (people, families, places, earliest/latest birth year)', de: 'Baum-Statistik (Personen, Familien, Orte, frühestes/spätestes Geburtsjahr)', ru: 'Статистика дерева (персоны, семьи, места, самый ранний/поздний год рождения)' } },
  { m: 'GET', p: '/api/v1/people?q&limit&offset', scope: 'read', d: { hu: 'Személyek listázása/keresése → { total, offset, items } (limit ≤ 500)', en: 'List/search people → { total, offset, items } (limit ≤ 500)', de: 'Personen listen/suchen → { total, offset, items } (limit ≤ 500)', ru: 'Список/поиск персон → { total, offset, items } (limit ≤ 500)' } },
  { m: 'GET', p: '/api/v1/people/{id}', scope: 'read', d: { hu: 'Személy-részletek → { person, parentsFamily, unions, events }', en: 'Person detail → { person, parentsFamily, unions, events }', de: 'Personendetails → { person, parentsFamily, unions, events }', ru: 'Данные персоны → { person, parentsFamily, unions, events }' } },
  { m: 'GET', p: '/api/v1/people/{id}/events', scope: 'read', d: { hu: 'Egy személy életeseményei (lakhelyek, tények…)', en: "A person's life events (residences, facts…)", de: 'Lebensereignisse einer Person (Wohnorte, Fakten…)', ru: 'События жизни персоны (места жительства, факты…)' } },
  { m: 'GET', p: '/api/v1/families?limit&offset', scope: 'read', d: { hu: 'Családok lapozva → { total, offset, items } (limit ≤ 1000, alap 200)', en: 'Families, paged → { total, offset, items } (limit ≤ 1000, default 200)', de: 'Familien, seitenweise → { total, offset, items } (limit ≤ 1000, Standard 200)', ru: 'Семьи с постраничной выдачей → { total, offset, items } (limit ≤ 1000, по умолчанию 200)' } },
  { m: 'GET', p: '/api/v1/families/{id}', scope: 'read', d: { hu: 'Egy család részletei', en: 'One family', de: 'Eine Familie', ru: 'Одна семья' } },
  { m: 'GET', p: '/api/v1/people/{id}/documents', scope: 'read', d: { hu: 'Egy személy dokumentumainak metaadatai', en: "A person's document metadata", de: 'Dokument-Metadaten einer Person', ru: 'Метаданные документов персоны' } },
  { m: 'GET', p: '/api/v1/people/{id}/citations', scope: 'read', d: { hu: 'Egy személy forráshivatkozásai (forráscím/szerző/szöveg, esemény-tag, minőség)', en: "A person's source citations (source title/author/text, event tag, quality)", de: 'Quellenzitate einer Person (Titel/Autor/Text, Ereignis-Tag, Qualität)', ru: 'Ссылки на источники персоны (название/автор/текст источника, тег события, качество)' } },
  { m: 'GET', p: '/api/v1/people/{id}/occupations', scope: 'read', d: { hu: 'Egy személy foglalkozásai (időszakkal)', en: "A person's occupations (time-scoped)", de: 'Berufe einer Person (mit Zeitraum)', ru: 'Профессии персоны (с указанием периода)' } },
  { m: 'GET', p: '/api/v1/occupations', scope: 'read', d: { hu: 'Minden foglalkozás, minden személytől', en: 'Every occupation of every person', de: 'Alle Berufe aller Personen', ru: 'Все профессии всех персон' } },
  { m: 'GET', p: '/api/v1/people/{id}/aliases', scope: 'read', d: { hu: 'Névváltozatok / álnevek', en: 'Name variants / AKA aliases', de: 'Namensvarianten / Aliasnamen', ru: 'Варианты имени / альтернативные имена' } },
  { m: 'GET', p: '/api/v1/aliases', scope: 'read', d: { hu: 'Minden névváltozat', en: 'Every alias', de: 'Alle Namensvarianten', ru: 'Все альтернативные имена' } },
  { m: 'GET', p: '/api/v1/people/{id}/godparents', scope: 'read', d: { hu: 'Keresztszülő-idk + kiknek keresztszülője → { godparentIds, godchildIds }', en: 'Godparent ids + godchildren → { godparentIds, godchildIds }', de: 'Paten-Ids + Patenkinder → { godparentIds, godchildIds }', ru: 'Идентификаторы крёстных + крестники → { godparentIds, godchildIds }' } },
  { m: 'GET', p: '/api/v1/people/{id}/notes', scope: 'read', d: { hu: 'Szabadszöveges jegyzetek', en: 'Free-text notes', de: 'Freitext-Notizen', ru: 'Заметки свободным текстом' } },
  { m: 'GET', p: '/api/v1/people/{id}/research-logs', scope: 'read', d: { hu: 'Kutatási napló bejegyzései a személyhez', en: 'Research log entries for the person', de: 'Recherche-Protokolleinträge zur Person', ru: 'Записи журнала исследований по персоне' } },
  { m: 'GET', p: '/api/v1/research-logs', scope: 'read', d: { hu: 'Minden kutatási bejegyzés (általánosak is)', en: 'Every research log entry (incl. general ones)', de: 'Alle Recherche-Einträge (auch allgemeine)', ru: 'Все записи журнала исследований (включая общие)' } },
  { m: 'GET', p: '/api/v1/people/{id}/collaborations', scope: 'read', d: { hu: 'FamilySearch-együttműködések (csak olvasható)', en: 'FamilySearch collaborations (read-only)', de: 'FamilySearch-Kollaborationen (nur lesend)', ru: 'Совместная работа FamilySearch (только чтение)' } },
  { m: 'GET', p: '/api/v1/places', scope: 'read', d: { hu: 'Geokódolt helynevek (név, koordináták)', en: 'Geocoded places (name, coordinates)', de: 'Geokodierte Orte (Name, Koordinaten)', ru: 'Геокодированные места (название, координаты)' } },
  { m: 'GET', p: '/api/v1/pedigree?rootId', scope: 'read', d: { hu: 'Pedigré-fa (házaspár-csomópontok, gyerekekkel)', en: 'Pedigree tree (couple nodes with children)', de: 'Ahnentafel (Paar-Knoten mit Kindern)', ru: 'Родословное дерево (узлы супружеских пар с детьми)' } },
  { m: 'GET', p: '/api/v1/atlas/points', scope: 'read', d: { hu: 'Minden geokódolt életesemény (térképpontok)', en: 'Every geocoded life event (map points)', de: 'Jedes geokodierte Lebensereignis (Kartenpunkte)', ru: 'Все геокодированные события жизни (точки на карте)' } },
  { m: 'GET', p: '/api/v1/export/gedcom', scope: 'read', d: { hu: 'Teljes GEDCOM 5.5.1 export → { gedcom }', en: 'Full GEDCOM 5.5.1 export → { gedcom }', de: 'Voller GEDCOM-5.5.1-Export → { gedcom }', ru: 'Полный экспорт GEDCOM 5.5.1 → { gedcom }' } },
  { m: 'POST', p: '/api/v1/people', scope: 'write', d: { hu: 'Személy létrehozása (PersonInput) → Person', en: 'Create a person (PersonInput) → Person', de: 'Person anlegen (PersonInput) → Person', ru: 'Создать персону (PersonInput) → Person' } },
  { m: 'PATCH', p: '/api/v1/people/{id}', scope: 'write', d: { hu: 'Személy mezőinek módosítása (részleges PersonInput)', en: 'Update person fields (partial PersonInput)', de: 'Personenfelder ändern (teilweises PersonInput)', ru: 'Изменить поля персоны (частичный PersonInput)' } },
  { m: 'DELETE', p: '/api/v1/people/{id}', scope: 'write', d: { hu: 'Személy törlése', en: 'Delete a person', de: 'Person löschen', ru: 'Удалить персону' } },
  { m: 'POST', p: '/api/v1/people/{id}/events', scope: 'write', d: { hu: 'Életesemény hozzáadása (EventInput)', en: 'Add a life event (EventInput)', de: 'Lebensereignis hinzufügen (EventInput)', ru: 'Добавить событие жизни (EventInput)' } },
  { m: 'DELETE', p: '/api/v1/events/{id}', scope: 'write', d: { hu: 'Életesemény törlése', en: 'Delete a life event', de: 'Lebensereignis löschen', ru: 'Удалить событие жизни' } },
  { m: 'POST', p: '/api/v1/families', scope: 'write', d: { hu: 'Család létrehozása (FamilyInput) → Family', en: 'Create a family (FamilyInput) → Family', de: 'Familie anlegen (FamilyInput) → Family', ru: 'Создать семью (FamilyInput) → Family' } },
  { m: 'PATCH', p: '/api/v1/families/{id}', scope: 'write', d: { hu: 'Család módosítása (childIds a teljes listát cseréli!)', en: 'Update a family (childIds replaces the whole list!)', de: 'Familie ändern (childIds ersetzt die ganze Liste!)', ru: 'Изменить семью (childIds заменяет весь список!)' } },
  { m: 'DELETE', p: '/api/v1/families/{id}', scope: 'write', d: { hu: 'Család törlése', en: 'Delete a family', de: 'Familie löschen', ru: 'Удалить семью' } },
  { m: 'GET', p: '/api/v1/documents/{id}/file', scope: 'documents', d: { hu: 'Nyers dokumentumfájl (kép/PDF bájtok; 409 = még nincs letöltve, 410 = hiányzik)', en: 'Raw document file (image/PDF bytes; 409 = not downloaded yet, 410 = missing)', de: 'Rohe Dokumentdatei (Bild/PDF-Bytes; 409 = noch nicht geladen, 410 = fehlt)', ru: 'Исходный файл документа (байты изображения/PDF; 409 — ещё не загружен, 410 — отсутствует)' } }
]

const SHAPES_CODE = `Person {
  id, givenName, surname, sex: 'M'|'F'|'U',
  birthDate, birthPlace, deathDate, deathPlace,   // string | null
  deceased: boolean, illegitimate: boolean,
  christeningDate, christeningPlace, burialDate, burialPlace,
  religion, notes                                  // string | null
}
PersonInput = a subset of the fields above (no id)

Family {
  id, husbandId, wifeId,                           // ids | null
  marriageDate, marriagePlace,                     // string | null
  marriageOrder,                                   // number | null (1., 2., …)
  notes, childIds: string[]
}

EventRecord {
  id, ownerType: 'person'|'family', ownerId,
  type,                                            // 'residence' | free-form
  date, endDate, place, value, note                // string | null
}
EventInput = { type?, date?, endDate?, place?, value?, note? }

DocumentMeta {
  id, title, kind: 'photo'|'certificate'|'census'|'letter'|'map'|'newspaper'|'other',
  mimeType, date, description, personIds: string[]
}

AtlasPoint {
  kind, personId, personName, sex,
  year, endYear,                                   // number | null
  date, place, lat, lon, detail
}

CitationDetail {
  id, sourceId, ownerType: 'person'|'family', ownerId,
  eventTag,                                        // e.g. 'BIRT', 'DEAT' | null
  page, quality, note,                             // string | null
  sourceTitle, sourceAuthor, sourcePublication,
  sourceText,                                      // transcription | null
  repositoryName, recordDate                       // string | null
}

Occupation { id, personId, title, startDate, endDate, note }
Alias      { id, personId, givenName, surname, kind, note }
NoteRecord { id, gedcomId, text }

ResearchLog {
  id, personId,                                    // personId null = general
  date, title, repository, sourceDesc, dateRange,
  result,                                          // e.g. 'found'|'not-found'|…
  detail, createdAt
}

Collaboration { id, personId, title, body, createdAt }  // read-only (FamilySearch)`

const MANIFEST_CODE = `{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "you",
  "description": {
    "hu": "Rövid leírás magyarul.",
    "en": "A short description in English.",
    "de": "Eine kurze Beschreibung auf Deutsch.",
    "ru": "Краткое описание по-русски."
  },
  "icon": "icon.svg",
  "permissions": ["read"],
  "menu": [
    {
      "id": "main",
      "title": { "hu": "Saját nézet", "en": "My view", "de": "Meine Ansicht", "ru": "Мой раздел" },
      "entry": "index.html"
    }
  ]
}`

const HTML_CODE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="tmplugin://sdk/treemonk.css" />
    <script src="tmplugin://sdk/treemonk.js"></script>
  </head>
  <body>
    <h1 id="title"></h1>
    <div id="out" class="tm-state">…</div>
    <script>
      document.getElementById('title').textContent =
        TM.t({ hu: 'Helló', en: 'Hello', de: 'Hallo' })

      TM.fetch('/api/v1/stats').then((s) => {
        document.getElementById('out').textContent =
          TM.t({ hu: 'Személyek', en: 'People', de: 'Personen' }) + ': ' + s.people
      })
    </script>
  </body>
</html>`

const GUIDES: Record<'hu' | 'en' | 'de' | 'ru', { title: string; intro: string; sections: Section[] }> = {
  hu: {
    title: 'Bővítmény készítése',
    intro:
      'Egy TreeMonk-bővítmény egy elszigetelt web-panel: egy mappa manifest.json-nal és egy HTML-fájllal, zipbe csomagolva. Nem kell hozzá build-rendszer, npm vagy keretrendszer. A csomagban lévő longevity-top példa teljes, kommentelt sablon.',
    sections: [
      {
        title: '1 · A homokozó — mit tud és mit nem tud egy bővítmény',
        paras: [
          'A panel sandboxolt iframe-ben fut: nincs Node, nincs Electron API. A tartalombiztonsági szabálya (CSP) kizárólag a http://127.0.0.1 felé enged hálózatot — az adatok fizikailag nem küldhetők ki az internetre.',
          'Minden API-hívást a bővítmény SAJÁT tokenje hitelesít, ami csak a manifestben kért jogosultságokra érvényes. A user a bekapcsoláskor hagyja jóvá ezeket, és a kikapcsolással bármikor visszavonja.'
        ]
      },
      {
        title: '2 · Fájlszerkezet és manifest.json',
        paras: [
          'my-plugin/ → manifest.json + index.html (+ icon.svg). A manifest minden mezőjét a telepítő ellenőrzi — a leírásnak és minden menücímnek mindhárom nyelven (hu/en/de) kötelező megadva lennie, különben a zip elutasításra kerül. A negyedik nyelv, a ru, opcionális: hozzáadhatod, de nélküle is telepíthető a bővítmény.',
          'Az id kisbetű/szám/kötőjel (2–64 karakter); az „sdk” foglalt. A permissions lehetséges értékei: read, write, documents. Az icon egy Lucide-stílusú SVG a csomagban (24×24 viewBox, fill="none", stroke="#000", stroke-width 2) — az app currentColor-maszkként rajzolja ki, így pontosan úgy színeződik, mint a beépített ikonok. Emoji is megengedett.'
        ],
        code: MANIFEST_CODE
      },
      {
        title: '3 · Indulási paraméterek (URL-hash)',
        paras: ['A belépő HTML mindent az URL-hashben kap:'],
        table: {
          head: ['Paraméter', 'Jelentés'],
          rows: [
            ['api', 'http://127.0.0.1:<port> — a helyi API címe'],
            ['token', 'A bővítmény saját, szűkített Bearer-tokenje'],
            ['lang', 'hu | en | de | ru — az app nyelve'],
            ['theme', 'light | dark — az app témája']
          ]
        }
      },
      {
        title: '4 · A hivatalos SDK (kötelező jellegű)',
        paras: [
          'Mindkét fájlt maga az app szolgálja ki a foglalt sdk hostról, offline is. A treemonk.js beolvassa a hash-paramétereket, beállítja a <html data-theme> attribútumot, és a TM segédet adja: TM.t({hu,en,de}) a nyelvhez, TM.fetch(útvonal) az API-hoz (auth + JSON kezelve), TM.api / TM.token / TM.lang / TM.theme.',
          'A treemonk.css a TreeMonk kinézetét adja: .tm-card, .tm-row, .tm-badge, .tm-btn, .tm-btn-primary, .tm-input, .tm-table, .tm-sub, .tm-muted, .tm-state. Saját CSS-hez a változókat használd: --tm-fg, --tm-muted, --tm-card, --tm-card-solid, --tm-border, --tm-accent, --tm-accent-soft, --tm-danger, --tm-radius. SOHA ne égess be szöveg- vagy háttérszínt — ettől automatikus a sötét mód.',
          'Nyelv- vagy témaváltáskor az app újratölti a panelt — futásidejű váltást nem kell kezelned.'
        ],
        code: HTML_CODE
      },
      {
        title: '5 · Jogosultságok és az API',
        table: {
          head: ['Jogosultság', 'Mire jogosít'],
          rows: [
            ['read', 'Minden GET: személyek (lista/keresés/részletek), családok, életesemények, pedigré, térképpontok, helyek, statisztika, GEDCOM-export'],
            ['write', 'POST/PATCH/DELETE: személy/család/életesemény létrehozás, módosítás, törlés — a UI-val azonos rétegen át (előzménynapló + visszavonás jár hozzá)'],
            ['documents', 'Nyers dokumentumfájlok (/api/v1/documents/{id}/file) — fotók, szkennelt iratok']
          ]
        },
        paras: [
          'Az API öndokumentáló: futó szerver mellett a http://127.0.0.1:<port>/docs cím háromnyelvű leírást ad, az /api/v1/openapi.json gépi sémát. Csak azt a jogosultságot kérd, amit tényleg használsz — a user a címkéket látja bekapcsolás előtt.'
        ]
      },
      {
        title: '6 · Csomagolás, telepítés, fejlesztés',
        paras: [
          'A mappa TARTALMÁT zippeld (a manifest a zip gyökerében vagy egyetlen felső mappában). Telepítés: oldalsáv → Bővítmények → Bővítmény hozzáadása. Ha a manifest hibás, a varázsló a validátor pontos üzenetét mutatja — azt kell javítani.',
          'Fejlesztés közben: az első telepítés után a kicsomagolt fájlokat közvetlenül szerkesztheted az app adatmappájában (%APPDATA%/treemonk/plugins/<id>), és a panel fejlécében lévő újratöltés gombbal frissíthetsz. Az azonos id-jű zip újratelepítése helyben frissít — a bekapcsolt állapot és a token megmarad.'
        ]
      },
      {
        title: '7 · Teljes API-referencia',
        apiRef: true,
        paras: [
          'Alap-URL: TM.api (http://127.0.0.1:<port>). Hitelesítés: Authorization: Bearer <TM.token> — a TM.fetch ezt magától intézi. Hibák: 401 érvénytelen token, 403 nem engedélyezett jogosultság, 404 ismeretlen id/útvonal; a hibatest { "error": "…" }. A dátumok ISO-szerű sztringek (lehet csak évszám vagy szöveges, pl. „abt 1850”) — évkinyerés: /\\d{4}/. Az id-k átlátszatlan sztringek: soha ne találd ki, mindig keresd ki őket. Minden írás bekerül az előzménynaplóba és visszavonható az appban.'
        ]
      },
      {
        title: '8 · Kiadási ellenőrzőlista',
        list: [
          'description + minden menücím hu/en/de nyelven (a telepítő ellenőrzi), a ru opcionális',
          'Minden látható szöveg TM.t({...})-n megy át',
          'Világosban ÉS sötétben is jó (válts témát — a panel újratölt)',
          'Színek a --tm-* változókból / SDK-osztályokból',
          'Lucide-stílusú SVG-ikon (vagy tudatosan választott emoji)',
          'Csak a ténylegesen használt jogosultságok',
          'Felhasználói szöveg textContent-tel kerül a DOM-ba (XSS!)',
          'Verziószám emelve a manifest.json-ban minden kiadásnál'
        ]
      }
    ]
  },
  en: {
    title: 'Build a plugin',
    intro:
      'A TreeMonk plugin is a sandboxed web panel: a folder with a manifest.json and an HTML file, zipped. No build tooling, npm or framework required. The bundled longevity-top example is a complete, commented template.',
    sections: [
      {
        title: '1 · The sandbox — what a plugin can and cannot do',
        paras: [
          'Your panel runs in a sandboxed iframe: no Node, no Electron APIs. Its Content-Security-Policy allows network access to http://127.0.0.1 only — data physically cannot be sent to the internet.',
          "Every API call is authenticated by the plugin's OWN token, valid only for the permissions the manifest declares. The user consents to them when enabling and can revoke at any time by disabling."
        ]
      },
      {
        title: '2 · File layout and manifest.json',
        paras: [
          'my-plugin/ → manifest.json + index.html (+ icon.svg). The installer validates every field — the description and every menu title MUST be given in all three languages (hu/en/de), or the zip is rejected. A fourth language, ru, is optional: add it if you like, the plugin installs fine without it.',
          'The id is lowercase letters/digits/dashes (2–64 chars); "sdk" is reserved. permissions values: read, write, documents. icon is a Lucide-style SVG in your zip (24×24 viewBox, fill="none", stroke="#000", stroke-width 2) — the app renders it as a currentColor mask, so it tints exactly like the built-in icons. An emoji also works.'
        ],
        code: MANIFEST_CODE
      },
      {
        title: '3 · Boot parameters (URL hash)',
        paras: ['Your entry HTML receives everything in the URL hash:'],
        table: {
          head: ['Param', 'Meaning'],
          rows: [
            ['api', 'http://127.0.0.1:<port> — the local API base'],
            ['token', "The plugin's own scoped Bearer token"],
            ['lang', "hu | en | de | ru — the app's UI language"],
            ['theme', "light | dark — the app's theme"]
          ]
        }
      },
      {
        title: '4 · The official SDK (strongly expected)',
        paras: [
          'Both files are served by the app itself from the reserved sdk host, offline too. treemonk.js parses the hash params, stamps <html data-theme> and exposes the TM helper: TM.t({hu,en,de}) for language, TM.fetch(path) for the API (auth + JSON handled), TM.api / TM.token / TM.lang / TM.theme.',
          "treemonk.css provides TreeMonk's look: .tm-card, .tm-row, .tm-badge, .tm-btn, .tm-btn-primary, .tm-input, .tm-table, .tm-sub, .tm-muted, .tm-state. For custom CSS use the variables: --tm-fg, --tm-muted, --tm-card, --tm-card-solid, --tm-border, --tm-accent, --tm-accent-soft, --tm-danger, --tm-radius. NEVER hard-code text or background colors — that is what makes dark mode automatic.",
          'The app reloads your panel whenever the user switches language or theme — no runtime handling needed.'
        ],
        code: HTML_CODE
      },
      {
        title: '5 · Permissions and the API',
        table: {
          head: ['Permission', 'Grants'],
          rows: [
            ['read', 'Every GET: people (list/search/detail), families, life events, pedigree, atlas points, places, stats, GEDCOM export'],
            ['write', 'POST/PATCH/DELETE: create/update/delete people, families, life events — through the same layer as the UI (audit log + undo included)'],
            ['documents', 'Raw document files (/api/v1/documents/{id}/file) — photos, scanned records']
          ]
        },
        paras: [
          'The API is self-documenting: with the server running, http://127.0.0.1:<port>/docs gives a trilingual reference and /api/v1/openapi.json a machine-readable schema. Only request permissions you actually use — the user sees the badges before enabling.'
        ]
      },
      {
        title: '6 · Packaging, installing, developing',
        paras: [
          "Zip the folder's CONTENTS (manifest at the zip root or inside a single top-level folder). Install via sidebar → Plugins → Add plugin. If the manifest is invalid, the wizard shows the validator's exact message — that is what to fix.",
          "While developing: after the first install you can edit the extracted files directly in the app's data folder (%APPDATA%/treemonk/plugins/<id>) and use the reload button in the panel header. Re-installing a zip with the same id updates in place — enabled state and token survive."
        ]
      },
      {
        title: '7 · Full API reference',
        apiRef: true,
        paras: [
          'Base URL: TM.api (http://127.0.0.1:<port>). Auth: Authorization: Bearer <TM.token> — TM.fetch handles it. Errors: 401 invalid token, 403 permission not granted, 404 unknown id/route; error body is { "error": "…" }. Dates are ISO-ish strings (may be a bare year or textual, e.g. "abt 1850") — extract years with /\\d{4}/. Ids are opaque strings: never invent them, always look them up. Every write is audit-logged and undoable in the app.'
        ]
      },
      {
        title: '8 · Release checklist',
        list: [
          'description + every menu title in hu/en/de (the installer checks), ru optional',
          'All visible text goes through TM.t({...})',
          'Looks right in light AND dark (toggle the theme — your panel reloads)',
          'Colors come from --tm-* variables / SDK classes',
          'Lucide-style SVG icon (or a deliberate emoji)',
          'Only the permissions you actually call',
          'User-sourced strings rendered with textContent (XSS!)',
          'Version bumped in manifest.json on every release'
        ]
      }
    ]
  },
  de: {
    title: 'Erweiterung entwickeln',
    intro:
      'Eine TreeMonk-Erweiterung ist ein isoliertes Web-Panel: ein Ordner mit manifest.json und einer HTML-Datei, gezippt. Kein Build-System, kein npm, kein Framework nötig. Das mitgelieferte Beispiel longevity-top ist eine vollständige, kommentierte Vorlage.',
    sections: [
      {
        title: '1 · Die Sandbox — was eine Erweiterung kann und was nicht',
        paras: [
          'Das Panel läuft in einem isolierten iframe: kein Node, keine Electron-APIs. Seine Content-Security-Policy erlaubt Netzwerkzugriff ausschließlich auf http://127.0.0.1 — Daten können physisch nicht ins Internet gesendet werden.',
          'Jeder API-Aufruf wird mit dem EIGENEN Token der Erweiterung authentifiziert, gültig nur für die im Manifest deklarierten Berechtigungen. Der Nutzer stimmt beim Aktivieren zu und kann jederzeit per Deaktivieren widerrufen.'
        ]
      },
      {
        title: '2 · Dateistruktur und manifest.json',
        paras: [
          'my-plugin/ → manifest.json + index.html (+ icon.svg). Der Installer validiert jedes Feld — die Beschreibung und jeder Menütitel MÜSSEN in allen drei Sprachen (hu/en/de) vorliegen, sonst wird das Zip abgelehnt. Eine vierte Sprache, ru, ist optional: füge sie gern hinzu, ohne sie lässt sich die Erweiterung ebenso installieren.',
          'Die id besteht aus Kleinbuchstaben/Ziffern/Bindestrichen (2–64 Zeichen); „sdk“ ist reserviert. permissions-Werte: read, write, documents. icon ist ein SVG im Lucide-Stil im Zip (24×24 viewBox, fill="none", stroke="#000", stroke-width 2) — die App rendert es als currentColor-Maske, es färbt sich also exakt wie die eingebauten Icons. Ein Emoji geht auch.'
        ],
        code: MANIFEST_CODE
      },
      {
        title: '3 · Startparameter (URL-Hash)',
        paras: ['Die Einstiegs-HTML erhält alles im URL-Hash:'],
        table: {
          head: ['Parameter', 'Bedeutung'],
          rows: [
            ['api', 'http://127.0.0.1:<port> — Basis der lokalen API'],
            ['token', 'Das eigene, eingeschränkte Bearer-Token der Erweiterung'],
            ['lang', 'hu | en | de | ru — die Sprache der App'],
            ['theme', 'light | dark — das Design der App']
          ]
        }
      },
      {
        title: '4 · Das offizielle SDK (dringend erwartet)',
        paras: [
          'Beide Dateien liefert die App selbst vom reservierten sdk-Host, auch offline. treemonk.js liest die Hash-Parameter, setzt <html data-theme> und stellt den TM-Helfer bereit: TM.t({hu,en,de}) für die Sprache, TM.fetch(pfad) für die API (Auth + JSON erledigt), TM.api / TM.token / TM.lang / TM.theme.',
          'treemonk.css liefert das TreeMonk-Erscheinungsbild: .tm-card, .tm-row, .tm-badge, .tm-btn, .tm-btn-primary, .tm-input, .tm-table, .tm-sub, .tm-muted, .tm-state. Für eigenes CSS die Variablen verwenden: --tm-fg, --tm-muted, --tm-card, --tm-card-solid, --tm-border, --tm-accent, --tm-accent-soft, --tm-danger, --tm-radius. NIEMALS Text- oder Hintergrundfarben hart codieren — genau das macht den Dunkelmodus automatisch.',
          'Bei Sprach- oder Themenwechsel lädt die App dein Panel neu — Laufzeit-Handling ist nicht nötig.'
        ],
        code: HTML_CODE
      },
      {
        title: '5 · Berechtigungen und die API',
        table: {
          head: ['Berechtigung', 'Gewährt'],
          rows: [
            ['read', 'Jedes GET: Personen (Liste/Suche/Detail), Familien, Lebensereignisse, Ahnentafel, Kartenpunkte, Orte, Statistik, GEDCOM-Export'],
            ['write', 'POST/PATCH/DELETE: Personen/Familien/Lebensereignisse anlegen, ändern, löschen — über dieselbe Schicht wie die UI (Änderungsverlauf + Rückgängig inklusive)'],
            ['documents', 'Rohe Dokumentdateien (/api/v1/documents/{id}/file) — Fotos, gescannte Urkunden']
          ]
        },
        paras: [
          'Die API ist selbstdokumentierend: Bei laufendem Server liefert http://127.0.0.1:<port>/docs eine dreisprachige Referenz, /api/v1/openapi.json ein maschinenlesbares Schema. Fordere nur Berechtigungen an, die du wirklich nutzt — der Nutzer sieht die Abzeichen vor dem Aktivieren.'
        ]
      },
      {
        title: '6 · Paketieren, Installieren, Entwickeln',
        paras: [
          'Zippe den INHALT des Ordners (Manifest im Zip-Stamm oder in einem einzigen Oberordner). Installation: Seitenleiste → Erweiterungen → Erweiterung hinzufügen. Ist das Manifest ungültig, zeigt der Assistent die exakte Validator-Meldung — genau das ist zu beheben.',
          'Beim Entwickeln: Nach der ersten Installation kannst du die entpackten Dateien direkt im Datenordner der App bearbeiten (%APPDATA%/treemonk/plugins/<id>) und den Neu-laden-Knopf in der Panel-Kopfzeile nutzen. Ein Zip mit derselben id erneut zu installieren aktualisiert in place — Aktiv-Status und Token bleiben erhalten.'
        ]
      },
      {
        title: '7 · Vollständige API-Referenz',
        apiRef: true,
        paras: [
          'Basis-URL: TM.api (http://127.0.0.1:<port>). Auth: Authorization: Bearer <TM.token> — TM.fetch erledigt das. Fehler: 401 ungültiges Token, 403 Berechtigung nicht gewährt, 404 unbekannte Id/Route; Fehlerkörper { "error": "…" }. Daten sind ISO-artige Strings (auch bloße Jahreszahl oder Text, z. B. „abt 1850“) — Jahr per /\\d{4}/ extrahieren. Ids sind opake Strings: nie erfinden, immer nachschlagen. Jeder Schreibzugriff landet im Änderungsverlauf und ist in der App rückgängig machbar.'
        ]
      },
      {
        title: '8 · Release-Checkliste',
        list: [
          'description + jeder Menütitel in hu/en/de (der Installer prüft), ru optional',
          'Jeder sichtbare Text läuft über TM.t({...})',
          'Sieht in Hell UND Dunkel richtig aus (Design umschalten — das Panel lädt neu)',
          'Farben kommen aus --tm-*-Variablen / SDK-Klassen',
          'SVG-Icon im Lucide-Stil (oder ein bewusst gewähltes Emoji)',
          'Nur tatsächlich genutzte Berechtigungen',
          'Nutzerdaten mit textContent ins DOM (XSS!)',
          'Version in manifest.json bei jedem Release erhöht'
        ]
      }
    ]
  },
  ru: {
    title: 'Создание плагина',
    intro:
      'Плагин TreeMonk — это изолированная веб-панель: папка с manifest.json и HTML-файлом, упакованная в zip. Не нужны ни система сборки, ни npm, ни фреймворк. Входящий в комплект пример longevity-top — это готовый шаблон с комментариями.',
    sections: [
      {
        title: '1 · Песочница — что плагин может и чего не может',
        paras: [
          'Ваша панель работает в изолированном iframe: ни Node, ни API Electron. Её политика безопасности содержимого (CSP) разрешает сетевые обращения только к http://127.0.0.1 — данные физически не могут быть отправлены в интернет.',
          'Каждый вызов API аутентифицируется СОБСТВЕННЫМ токеном плагина, который действует только для разрешений, объявленных в манифесте. Пользователь соглашается с ними при включении плагина и в любой момент отзывает их, отключив плагин.'
        ]
      },
      {
        title: '2 · Структура файлов и manifest.json',
        paras: [
          'my-plugin/ → manifest.json + index.html (+ icon.svg). Установщик проверяет каждое поле — описание и каждый заголовок меню ОБЯЗАТЕЛЬНО должны быть заданы на всех трёх языках (hu/en/de), иначе zip будет отклонён. Четвёртый язык, ru, — опциональный: добавьте его, если хотите, но и без него плагин устанавливается.',
          'id состоит из строчных латинских букв, цифр и дефисов (2–64 символа); «sdk» зарезервировано. Возможные значения permissions: read, write, documents. icon — это SVG в стиле Lucide внутри zip (viewBox 24×24, fill="none", stroke="#000", stroke-width 2) — приложение отрисовывает его как маску currentColor, поэтому он окрашивается ровно так же, как встроенные значки. Эмодзи тоже подойдёт.'
        ],
        code: MANIFEST_CODE
      },
      {
        title: '3 · Параметры запуска (хеш URL)',
        paras: ['Входной HTML получает всё в хеше URL:'],
        table: {
          head: ['Параметр', 'Значение'],
          rows: [
            ['api', 'http://127.0.0.1:<port> — адрес локального API'],
            ['token', 'Собственный ограниченный Bearer-токен плагина'],
            ['lang', 'hu | en | de | ru — язык интерфейса приложения'],
            ['theme', 'light | dark — тема приложения']
          ]
        }
      },
      {
        title: '4 · Официальный SDK (настоятельно рекомендуется)',
        paras: [
          'Оба файла отдаёт само приложение с зарезервированного хоста sdk, в том числе без сети. treemonk.js разбирает параметры хеша, выставляет атрибут <html data-theme> и предоставляет помощник TM: TM.t({hu,en,de}) — для языка, TM.fetch(путь) — для API (авторизация и JSON уже обработаны), TM.api / TM.token / TM.lang / TM.theme.',
          'treemonk.css задаёт внешний вид TreeMonk: .tm-card, .tm-row, .tm-badge, .tm-btn, .tm-btn-primary, .tm-input, .tm-table, .tm-sub, .tm-muted, .tm-state. Для собственного CSS используйте переменные: --tm-fg, --tm-muted, --tm-card, --tm-card-solid, --tm-border, --tm-accent, --tm-accent-soft, --tm-danger, --tm-radius. НИКОГДА не задавайте цвет текста или фона жёстко — именно поэтому тёмная тема работает сама.',
          'При переключении языка или темы приложение перезагружает вашу панель — обрабатывать это во время работы не нужно.'
        ],
        code: HTML_CODE
      },
      {
        title: '5 · Разрешения и API',
        table: {
          head: ['Разрешение', 'Что даёт'],
          rows: [
            ['read', 'Все GET: персоны (список/поиск/подробности), семьи, события жизни, родословное дерево, точки Атласа, места, статистика, экспорт GEDCOM'],
            ['write', 'POST/PATCH/DELETE: создание, изменение и удаление персон, семей и событий жизни — через тот же слой, что и интерфейс (журнал изменений и отмена включены)'],
            ['documents', 'Исходные файлы документов (/api/v1/documents/{id}/file) — фотографии, сканы записей']
          ]
        },
        paras: [
          'API документирует себя сам: при запущенном сервере http://127.0.0.1:<port>/docs даёт трёхъязычный справочник, а /api/v1/openapi.json — машиночитаемую схему. Запрашивайте только те разрешения, которыми действительно пользуетесь — пользователь видит их метки до включения плагина.'
        ]
      },
      {
        title: '6 · Упаковка, установка, разработка',
        paras: [
          'Упакуйте в zip СОДЕРЖИМОЕ папки (манифест в корне архива или внутри единственной папки верхнего уровня). Установка: боковая панель → Плагины → Добавить плагин. Если манифест некорректен, мастер покажет точное сообщение валидатора — именно его и нужно исправить.',
          'Во время разработки: после первой установки распакованные файлы можно править прямо в папке данных приложения (%APPDATA%/treemonk/plugins/<id>) и нажимать кнопку перезагрузки в заголовке панели. Повторная установка zip с тем же id обновляет плагин на месте — включённое состояние и токен сохраняются.'
        ]
      },
      {
        title: '7 · Полный справочник по API',
        apiRef: true,
        paras: [
          'Базовый URL: TM.api (http://127.0.0.1:<port>). Аутентификация: Authorization: Bearer <TM.token> — TM.fetch делает это сам. Ошибки: 401 — недействительный токен, 403 — разрешение не выдано, 404 — неизвестный id или путь; тело ошибки — { "error": "…" }. Даты — строки в духе ISO (может быть просто год или текст, например «abt 1850») — год извлекайте через /\\d{4}/. Идентификаторы — непрозрачные строки: никогда не придумывайте их, всегда запрашивайте. Каждая запись попадает в журнал изменений и может быть отменена в приложении.'
        ]
      },
      {
        title: '8 · Контрольный список перед выпуском',
        list: [
          'description и каждый заголовок меню на hu/en/de (установщик проверяет), ru — по желанию',
          'Весь видимый текст проходит через TM.t({...})',
          'Выглядит правильно и в светлой, И в тёмной теме (переключите тему — панель перезагрузится)',
          'Цвета берутся из переменных --tm-* и классов SDK',
          'Значок — SVG в стиле Lucide (или осознанно выбранное эмодзи)',
          'Только те разрешения, которые действительно вызываются',
          'Пользовательский текст попадает в DOM через textContent (XSS!)',
          'Версия в manifest.json увеличена для каждого выпуска'
        ]
      }
    ]
  }
}

export function PluginDevGuideView(): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = (['hu', 'en', 'de', 'ru'].includes(i18n.language.slice(0, 2)) ? i18n.language.slice(0, 2) : 'en') as
    | 'hu'
    | 'en'
    | 'de'
    | 'ru'
  const guide = useMemo(() => GUIDES[lang], [lang])

  const copySpec = (): void => {
    void navigator.clipboard.writeText(PLUGIN_LLM_SPEC)
    toast.success(t('plugins.copiedForLlm'))
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="plugin-guide-view">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-2 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-card">
            <Code2 className="h-5 w-5 text-primary" />
          </div>
          <h1 className="min-w-0 flex-1 text-xl font-bold leading-tight">{guide.title}</h1>
          <Button onClick={copySpec} className="gap-2" data-testid="plugin-guide-copy">
            <Copy className="h-4 w-4" />
            {t('plugins.copyForLlm')}
          </Button>
        </div>
        <p className="mb-2 text-sm text-muted-foreground">{guide.intro}</p>
        <p className="mb-6 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          {t('plugins.copyForLlmDesc')}
        </p>

        <div className="space-y-6">
          {guide.sections.map((s) => (
            <section key={s.title} className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-2 text-sm font-bold">{s.title}</h2>
              {s.paras?.map((p) => (
                <p key={p.slice(0, 24)} className="mb-2 text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
              {s.table && (
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr>
                      {s.table.head.map((h) => (
                        <th
                          key={h}
                          className="border-b border-border px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.rows.map((r) => (
                      <tr key={r[0]}>
                        <td className="border-b border-border/60 px-2 py-1.5 font-mono text-xs text-primary">{r[0]}</td>
                        <td className="border-b border-border/60 px-2 py-1.5 text-muted-foreground">{r[1]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {s.code && (
                <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-secondary/50 p-3 font-mono text-xs leading-relaxed">
                  {s.code}
                </pre>
              )}
              {s.apiRef && (
                <>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {API_ROWS.map((r) => (
                          <tr key={`${r.m} ${r.p}`}>
                            <td className="whitespace-nowrap border-b border-border/60 px-2 py-1.5 align-top font-mono text-[11px] font-bold">
                              <span
                                className={
                                  r.m === 'GET'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : r.m === 'DELETE'
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                }
                              >
                                {r.m}
                              </span>
                            </td>
                            <td className="border-b border-border/60 px-2 py-1.5 align-top font-mono text-xs text-primary">
                              {r.p}
                            </td>
                            <td className="whitespace-nowrap border-b border-border/60 px-2 py-1.5 align-top">
                              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                {r.scope}
                              </span>
                            </td>
                            <td className="border-b border-border/60 px-2 py-1.5 align-top text-xs text-muted-foreground">
                              {r.d[lang]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-secondary/50 p-3 font-mono text-xs leading-relaxed">
                    {SHAPES_CODE}
                  </pre>
                  <h3 className="mb-1 mt-4 text-sm font-bold">
                    {
                      {
                        hu: 'Példa kérések és válaszok',
                        en: 'Example requests & responses',
                        de: 'Beispiel-Anfragen und -Antworten',
                        ru: 'Примеры запросов и ответов'
                      }[lang]
                    }
                  </h3>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {{
                      hu: 'Valósághű mintaadatokkal — a mezőnevek és a válaszborítékok innen másolhatók.',
                      en: 'With realistic sample data — copy field names and response envelopes from here.',
                      de: 'Mit realistischen Beispieldaten — Feldnamen und Antwort-Umschläge hier abschreiben.',
                      ru: 'С реалистичными тестовыми данными — имена полей и обёртки ответов можно копировать отсюда.'
                    }[lang]}
                  </p>
                  <pre className="overflow-x-auto rounded-xl border border-border bg-secondary/50 p-3 font-mono text-xs leading-relaxed">
                    {API_EXAMPLES}
                  </pre>
                </>
              )}
              {s.list && (
                <ul className="mt-2 space-y-1.5">
                  {s.list.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
