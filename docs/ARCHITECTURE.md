# DeckHack: Architektur und Design

Stand: 17.11.2026. Entwurf, auf Deutsch; README und Code sind englisch.

## Kurzfassung

DeckHack ist eine statische Web-App ohne eigenes Backend: Sie zeigt ein HTML-Deck Folie für Folie, sammelt Kommentare direkt an der Folie, lässt eine KI die Änderungen als gezielte Datei-Edits einbauen und hält jede Fassung als Version fest. Das Deck bleibt ein normaler Ordner aus HTML, CSS und JS in deinem GitHub-Repo und läuft ohne DeckHack weiter.

Fünf Entscheidungen tragen den Entwurf:

| Entscheidung | Gewählt | Warum |
| --- | --- | --- |
| Betrieb | Statische App im Browser, kein Server, lokal gestartet (`docker compose up` oder `npm start`) | Niemand hostet die App für andere, kein Betreiber sieht Keys oder Decks. GitHub Pages zeigt nur die Landingpage, die App läuft dort nicht |
| Deck-Format | Beliebiger HTML-Ordner, Folien über Adapter erkannt | Euer Aloha-Deck baut Szenen per JavaScript, nicht als `<section>`. Ein festes Format hätte genau das echte Deck ausgeschlossen |
| Vorschau | Sandbox-iframe ohne Zugriff auf die App | Deck-Code aus Links und von der KI ist nicht vertrauenswürdig und darf den API-Key nie lesen können |
| KI-Änderung | Edits per Werkzeugaufruf statt ganzer Dateien, danach automatische Prüfung | Schnell und günstig bei 40-KB-Skripten, und die App kann zeigen, welche Folien sich wirklich geändert haben |
| Versionen | Lokale Snapshots für jeden Schritt, GitHub-Commit beim Speichern | Zurückspringen kostet nichts, das Repo bleibt die Wahrheit und das Backup |

**Geschärfter Auftrag.** Ziel dahinter: Ein Team soll in der letzten Nacht vor dem Pitch zwanzig kleine Korrekturen in Minuten statt in einem langen Chat-Monolog durchbringen, ohne dass dabei eine andere Folie kaputtgeht. Als Tätigkeit: durchklicken, an der Stelle anmerken, einmal anwenden, prüfen, weiter. Ehrgeiziges Ziel: von Kommentar bis geprüfter neuer Fassung einer Folie unter 60 Sekunden, und nach jeder KI-Änderung sagt die App belegt „nur Folie 8 geändert“. Geprüft wird das Grundgerüst durch einen automatischen Browser-Durchlauf mit eurem echten Aloha-Deck.

## Einordnung: was es schon gibt

Die Idee „Kommentare an die Folie heften und gebündelt anwenden“ gibt es bereits, aber nur für Leute mit lokalem Entwickler-Setup und in einem eigenen Deck-Format. Die Lücke ist ein Werkzeug, das ohne Installation im Browser auf einem beliebigen, schon vorhandenen HTML-Deck arbeitet.

| Projekt | Was es ist | Was für deinen Ablauf fehlt |
| --- | --- | --- |
| [frontend-slides](https://open-design.ai/blog/frontend-slides/) | Skill für Coding-Agenten, der HTML-Decks erzeugt. MIT, laut Artikel rund 25.000 Sterne | Kein Editor und kein Viewer. Änderungen laufen weiter über den Chat, also genau der Monolog, den du loswerden willst |
| [open-slide](https://notes.nicolasdeville.com/github/open-slide/) | Folien-Framework für Agenten mit Inspektor, an Elemente gehefteten Kommentaren und `/apply-comments`. MIT, 7.717 Sterne zum 2.0-Release | Braucht lokalen Dev-Server, Node und einen Coding-Agenten. Folien sind React-Komponenten, ein bestehendes HTML-Deck lässt sich nicht einfach öffnen |
| [oh-my-ppt](https://dev.to/arcsin1/oh-my-ppt-local-first-ai-slide-deck-generator-editor-30ei) | Lokaler KI-Generator und Editor für HTML-Folien mit seitenweisem KI-Edit und Rollback | Läuft auf dem eigenen Rechner und erzeugt Decks im eigenen Format, kein Git-Bezug |

Empfehlung: selbst bauen, aber zwei Dinge übernehmen. Von open-slide die Idee, Kommentare später an einzelne Elemente statt nur an Folien zu heften. Und Decks aus frontend-slides als erstklassigen Eingang behandeln: Dessen Nutzer haben genau dein Problem und sind die naheliegende erste Community. Wer bereit ist, auf React-Folien und einen lokalen Agenten umzusteigen, ist mit open-slide heute schon bedient. Das ist die ehrliche Alternative zum Selbstbauen.

## Systemüberblick

Die App besteht aus drei Bausteinen im Browser und spricht mit genau zwei Diensten, beide mit deinen eigenen Zugangsdaten.

```
Quellen                    DeckHack im Browser                         Dienste (eigene Zugangsdaten)

Vorlage      ─┐            ┌─ Vorschau: Sandbox-iframe + Bridge
Upload / ZIP ─┼─ Dateien ─▶├─ Review-Runde: Kommentare ─▶ Edits ─▶ Prüfung ──▶ Claude API
GitHub-Link  ─┘            └─ Versionen: IndexedDB ──────────────────────────▶ GitHub (laden, committen)
```

Die Review-Runde ist die Mitte: Sie liest die Dateien der aktuellen Version, lässt die KI Edits liefern, rendert das Ergebnis in der Sandbox und legt erst nach der Prüfung eine neue Version an. Es gibt keinen Server, der Decks oder Keys sehen könnte.

## Deck-Modell und Folienerkennung

Ein Deck ist ein Ordner mit Dateien, mehr nicht. DeckHack schreibt nichts Eigenes hinein, außer auf Wunsch einer kleinen `deckhack.json`, die Einstiegsdatei und Erkennung festlegt.

Intern kennt die App drei Dateiarten: Text (HTML, CSS, JS, SVG, JSON), der bearbeitet werden kann, lokale Binärdateien aus einem Upload, und entfernte Binärdateien, die im GitHub-Repo bleiben und per URL geladen werden, fest an den Commit gebunden. So muss ein 5-MB-Teamvideo nie durch den Browser-Speicher.

Die Folien findet ein Adapter, der im Vorschau-Fenster läuft:

| Adapter | Erkennt | Navigation | Beispiel |
| --- | --- | --- | --- |
| `sections` | Ein Element pro Folie: `section.slide`, `.slide`, reveal.js, `main > section` | Hinscrollen, sonst Pfeiltasten | Vorlagen, Decks aus frontend-slides |
| `keys` | Decks, die Szenen per JavaScript bauen und einen Zähler wie „08 / 17“ zeigen | Simulierte Pfeiltasten, bis der Zähler stimmt | Euer Aloha-Pitch |
| `single` | Nichts davon | Keine, Kommentare gelten fürs ganze Deck | Unbekannte Seiten |

Der `keys`-Adapter ist der Grund, warum euer echtes Deck funktioniert: Es hat keine Folien-Elemente im HTML, sondern ein `SCENES`-Array in `demo.js` mit Schritten pro Szene. Die Schritte bleiben erhalten, „Schritt vor“ und „Schritt zurück“ sind eigene Knöpfe.

Neue Formate kommen als weiterer Adapter dazu. Geplant ist außerdem ein Einrichtungsschritt, bei dem die KI ein unbekanntes Deck liest und die `deckhack.json` vorschlägt.

## Vorschau und Sicherheit

Deck-Code gilt immer als nicht vertrauenswürdig, egal ob er aus einem Link, einem Upload oder von der KI stammt. Er läuft ausschließlich in einem iframe mit `sandbox="allow-scripts"`.

Das hat drei Folgen. Der iframe bekommt einen eigenen, leeren Origin und kann weder den Speicher der App noch den API-Key lesen. Er kann die App nicht umleiten und keine Fenster öffnen. Und die einzige Verbindung ist `postMessage` mit einem Token, das bei jedem Laden neu erzeugt wird.

Damit ein Deck aus mehreren Dateien in so einem Fenster läuft, baut ein Bundler im Browser aus dem Ordner ein einziges HTML-Dokument: lokale Stylesheets und Skripte werden eingebettet, Bilder und Videos auf Data- oder Repo-URLs umgebogen. Als erstes Skript kommt eine kleine Bridge hinein, die nur in der Vorschau existiert und nie im Deck landet. Sie leistet fünf Dinge:

- Folien erkennen, anspringen und die aktuelle Position melden
- Animationen einfrieren oder laufen lassen („mit und ohne Animation“)
- Fehler aus dem Deck sammeln
- Pfade auflösen, die das Deck erst zur Laufzeit zusammensetzt, etwa `assets/${name}.webp`
- Browser-Funktionen ersetzen, die in der Sandbox verboten sind (`localStorage`, `history.replaceState`)

Den letzten Punkt hat erst der Test mit dem Aloha-Deck aufgedeckt: Es schreibt bei jedem Folienwechsel `?s=8` in die Adresse und stürzte in der Sandbox zunächst ab.

Bekannte Grenzen: ES-Module mit lokalen Importen werden noch nicht gebündelt. Und auf GitHub Pages teilen sich alle Projekte eines Nutzers einen Origin. Wer „Key merken“ einschaltet, sollte die App deshalb unter einer eigenen Domain betreiben. Standard ist: Key nur für die Dauer des Tabs. Dauerhaftes Merken ist ein Opt-in mit Warnhinweis, „Remove stored keys“ löscht wieder. Die App empfiehlt einen eigenen Key für DeckHack in einem Workspace mit Ausgabelimit. Als zweite Schutzschicht hinter der Sandbox erlaubt eine Content-Security-Policy der Seite und der Vorschau Verbindungen nur zu `api.anthropic.com`, `api.github.com` und `cdn.jsdelivr.net`.

## KI-Überarbeitung

Eine Review-Runde schickt alle offenen Kommentare in einem Auftrag an das Modell und bekommt gezielte Datei-Edits zurück, keine neu geschriebenen Dateien.

1. **Sammeln.** Kommentare hängen an einer Folie oder am ganzen Deck. „Nur diese Folie“ und „ganzes Deck neu“ sind derselbe Ablauf mit anderem Umfang.
2. **Auftrag bauen.** Fester Systemprompt, dann der Deck-Inhalt mit Folienliste als cachebarer Block, dann die Kommentare. Bei mehreren Runden auf derselben Fassung wird der Deck-Block aus dem Cache gelesen.
3. **Edits als Werkzeugaufrufe.** Drei Werkzeuge: `replace_in_file` (alter Text muss exakt und genau einmal vorkommen), `write_file`, `delete_file`. Jeder Aufruf wird geprüft: nur Pfade im Deck, nur Textdateien. Schlägt ein Edit fehl, bekommt das Modell die Fehlermeldung und korrigiert sich.
4. **Prüfen.** Die neue Fassung wird unsichtbar gerendert, jede Folie mit eingefrorenen Animationen angesprungen und ein Fingerabdruck aus Markup, Text, Farben, Schrift und Positionen gebildet. Der Vergleich mit der Vorfassung ergibt die Liste der wirklich geänderten Folien.
5. **Reparieren.** Erzeugt die Änderung neue Fehler beim Laden, bekommt das Modell genau einen Reparaturversuch mit den Fehlertexten.
6. **Ergebnis.** Neue Version, dazu die Meldung „Geändert: Folie 8. Alle anderen Folien unverändert“ oder die Warnung, dass eine unkommentierte Folie mitgeändert wurde.

Schritt 4 ist der Kern des Werkzeugs. Bei Decks wie eurem teilen sich alle Folien ein Stylesheet und ein Skript, und ein gut gemeinter Edit an Folie 8 verschiebt leicht Folie 3. Im Chat merkt man das erst auf der Bühne.

Der Aufruf geht direkt aus dem Browser an die Claude-API, mit dem Key des Nutzers. Standardmodell ist Claude Opus 5.5 mit mittlerem Aufwand, wählbar sind Sonnet 5.5 für kleine Textkorrekturen und Fable 5.2 für den Umbau ganzer Decks. Lehnt ein Sicherheitsfilter eine Anfrage ab, wiederholt die API sie automatisch auf einem Ausweichmodell. Diese Fallback-Option habe ich eingeschaltet. Andere Anbieter passen hinter dieselbe kleine Schnittstelle.

Daneben gibt es einen Demo-Modus ohne KI und ohne Netz, der nur `replace "alt" with "neu"` versteht. Mit ihm lässt sich der ganze Ablauf ausprobieren und automatisch testen.

## Versionierung und Speichern

Versionen entstehen in zwei Schichten: lokal bei jedem Schritt, im Repo beim Speichern.

**Lokal.** Jede KI-Runde und jede Wiederherstellung erzeugt eine Version in der IndexedDB des Browsers. Dateiinhalte liegen einmal pro Inhalts-Hash, eine neue Version kostet also nur die geänderten Dateien. Zu jeder Version gehören das Prüfergebnis, die geänderten Folien und die geänderten Dateien.

**Zurückspringen löscht nie.** Wer v2 wiederherstellt, bekommt v5 mit dem Inhalt von v2. Kommentare, die in den übersprungenen Versionen angewendet wurden, werden wieder offen. „Vorher zeigen“ und „Nachher zeigen“ schalten die Bühne zwischen zwei Versionen um und behalten die Folie bei.

**Im Repo.** „Speichern“ schreibt die geänderten Textdateien als einen Commit über die Git-Data-API von GitHub. Ziel ist ein eigener Branch, Vorschlag `deckhack/<deckname>`, der bei Bedarf aus dem Quell-Branch entsteht. Auf `main` landet nichts ohne Pull Request. Decks ohne Repo werden als ZIP heruntergeladen.

Bewusst nicht gewählt: ein vollständiges Git im Browser. Es brächte einen CORS-Proxy fürs Klonen und damit doch wieder einen Server.

## Vorlagen und Community

Beitragen soll so leicht sein wie ein Ordner in einem Pull Request. Es gibt drei klar abgegrenzte Stellen dafür:

| Beitrag | Was man liefert | Aufwand |
| --- | --- | --- |
| Vorlage | Ordner unter `templates/` mit `index.html` und `deckhack.json` (Name, Beschreibung, Autor). Nur Textdateien, keine externen Anfragen, damit sie auch bei schlechtem WLAN am Veranstaltungsort läuft | Ein Abend |
| Adapter | Erkennung für ein weiteres Deck-Format in der Bridge, plus ein Testdeck | Ein paar Stunden |
| KI-Anbieter | Implementierung der Schnittstelle `Provider` | Ein paar Stunden |

Die Vorlage „Three-minute pitch“ gibt die Jury-Dramaturgie vor: Aufhänger, Problem, Lösung, Demo, Funktionsweise, Team, Bitte. Als nächster Schritt füllt die KI sie aus einem kurzen Formular (Team, Challenge, Problem, Lösung, Redezeit).

Drei Hebel für die Community, in dieser Reihenfolge:

1. **Euer eigener Pitch als Vorzeigefall.** Platz 4 in Erlangen mit einem so gebauten Deck ist die glaubwürdigste Werbung. Das Aloha-Deck sollte als Beispiel ladbar sein.
2. **Ein Klick zum Ausprobieren.** Die gehostete App soll ein Deck direkt aus einem Link öffnen, etwa `?deck=github.com/du/repo`. Ein Badge im README fremder Hackathon-Repos führt dann in den Editor.
3. **Vorlagen-Galerie mit Namen.** Jede Vorlage nennt ihr Team und den Hackathon. Das gibt Teilnehmern einen Grund, ihr Deck nach dem Event beizusteuern.

Lizenz ist MIT. Im Repo liegen README, CONTRIBUTING, CI und ein Workflow für GitHub Pages schon bereit.

## Design- und UI-Konzept

Das Leitbild ist ein Regieraum: ruhige Technik rund um eine beleuchtete Bühne. Die Oberfläche tritt zurück, das Deck ist das Einzige mit Charakter.

**Aufbau.** Drei Spalten unter einer schmalen Kopfzeile.

| Bereich | Inhalt | Warum so |
| --- | --- | --- |
| Links: Folienleiste | Nummer, Titel, gelbe Marke mit Anzahl offener Kommentare, blauer Punkt für „in dieser Version geändert“ | Man sieht auf einen Blick, wo noch Arbeit liegt und was die letzte Runde angefasst hat |
| Mitte: Bühne | Deck in fester Größe von 1280 × 720, auf den Platz skaliert. Darunter Folie vor und zurück, Schritt vor und zurück, Animationen an oder aus, Replay, Präsentieren | Feste Größe heißt: Die Folie sieht im Editor aus wie am Beamer |
| Rechts: Review und Versionen | Kommentare zur aktuellen Folie, Eingabefeld, „Runde anwenden“, Protokoll, Ergebnis. Zweiter Reiter: Versionsliste | Der Blick bleibt auf der Folie, die Hand beim Kommentar |
| Kopfzeile | Deckname, Quelle, Versionsmarke, Speichern, Einstellungen | Speichern ist selten, also klein |

**Kernablauf.** Folie anklicken, Kommentar tippen, Enter. Nächste Folie. Am Ende einmal „Runde anwenden“. Das Ergebnis erscheint als Karte mit der Prüfmeldung, darunter „Vorher zeigen“ und „Rückgängig“. Kein Dialog, kein Seitenwechsel.

**Farbe mit Bedeutung.** Es gibt genau zwei Rollen. Kobaltblau steht für alles, was man tun kann. Markergelb steht für Notizen, die noch warten, wie ein Klebezettel auf einem Ausdruck. Grün, Orange und Rot sind für Prüfergebnisse reserviert. Die Flächen sind ein kühles Schiefergrau statt Schwarz oder Weiß, damit dunkle wie helle Decks davor gut stehen. Helles und dunkles Thema folgen dem System.

**Schrift.** Systemschrift für die Oberfläche, Festbreitenschrift für alles, was gezählt wird: Foliennummern, Versionen, Protokoll. Keine Webfonts, die App lädt nichts von Dritten.

**Sprache.** Englisch, weil die Zielgruppe international ist. Knöpfe sagen, was passiert („Apply round“, „Restore this version“), Fehler sagen, was zu tun ist.

**Schmale Bildschirme.** Unter 900 px steht die Bühne oben, die Folien werden zur waagerechten Leiste, Review folgt darunter. Kommentieren am Handy geht, bearbeitet wird am Laptop.

**Noch nicht gebaut, aber vorgesehen:** Miniaturbilder in der Folienleiste, Kommentare per Klick auf ein Element der Folie, ein Schieber für den Vorher-Nachher-Vergleich und ein Presenter-Modus mit Notizen und Timer.

## Tech-Stack und Repo-Struktur

TypeScript, React 19 und Vite, ausgeliefert als statische Dateien. Das ist der Stack, den die meisten Beitragenden und jede Coding-KI am besten kennen.

| Baustein | Wahl | Anmerkung |
| --- | --- | --- |
| Oberfläche | React 19, eigenes CSS mit Tokens | Keine UI-Bibliothek, rund 200 Zeilen CSS |
| KI | `@anthropic-ai/sdk` im Browser | Wird erst beim ersten KI-Aufruf nachgeladen |
| ZIP | `fflate` | Einzige weitere Laufzeit-Abhängigkeit |
| Speicher | IndexedDB direkt | Rund 150 Zeilen |
| GitHub | REST-API per `fetch` | Kein SDK |
| Tests | Vitest für die Kernlogik, Playwright für den Durchlauf im Browser | Beide laufen in der CI |

| Ordner | Aufgabe |
| --- | --- |
| `src/core/` | Deck-Modell, Edits, Bundler, Bridge, Vorschau, Versionen |
| `src/sources/` | Upload, GitHub laden und committen, Vorlagen |
| `src/ai/` | Anbieter-Schnittstelle, Claude, Demo-Modus, Review-Runde mit Prüfung |
| `src/ui/` | Start, Editor, Dialoge, Styles |
| `templates/` | Vorlagen als einfache Ordner |
| `tests/` | 13 Unit-Tests, ein Browser-Durchlauf mit 15 Prüfungen |

Die Kernlogik in `src/core/` kennt kein React. Sie lässt sich später auch in einer GitHub Action verwenden, die bei jedem Commit alle Folien fotografiert, so wie euer `shots.mjs`.

## Stand und Fahrplan

Das Grundgerüst läuft: Der gesamte Review-Ablauf funktioniert im Demo-Modus und ist automatisch geprüft, auch mit eurem echten Aloha-Deck. Zwei Wege sind gebaut, aber noch nie gegen den echten Dienst gelaufen: der Claude-Aufruf und der GitHub-Commit. Dafür fehlten hier Key und Token.

| Geprüft am 17.11.2026 | Ergebnis |
| --- | --- |
| Typecheck, Lint, 13 Unit-Tests | Grün |
| Browser-Durchlauf mit Vorlage: laden, 7 Folien erkennen, kommentieren, anwenden, „nur Folie 1 geändert“, v1 wiederherstellen | 10 von 10 |
| Sandbox: Deck-Code kann die App nicht lesen | Bestätigt |
| Aloha-Deck als ZIP: 17 Szenen über den Zähler erkannt, Sprung auf Folie 8, keine Fehler, Bilder geladen | Bestätigt |
| Aloha-Deck: Textänderung auf Folie 8 wird als „nur Folie 8“ gemeldet | Bestätigt |
| Claude-API aus dem Browser, GitHub laden und committen | Nicht getestet |

**Nachtrag vom Abend des 17.11.2026.** Seit dem ersten Stand dazugekommen und geprüft (51 Unit-Tests, 32 Browser-Prüfungen, 35 mit dem Aloha-Deck):

| Baustein | Stand |
| --- | --- |
| Beispiel-Deck mit Dummy-Daten, Start-Wizard | Fertig, getestet |
| Key-Absicherung: nur Tab-Sitzung, Opt-in mit Warnung, Content-Security-Policy | Fertig, getestet |
| Kommentar per Klick auf ein Element, Token-Schätzung vor dem Senden, Deck per Link (`?example`, `?template=`, `?deck=`) | Fertig, getestet (`?deck=` nur bis zum Aufruf, GitHub selbst ungetestet) |
| Evals: 12 Fälle, deterministische Bewertung, Workflow | Bewertung getestet, kein Live-Lauf |
| Landingpage, Screenshots und GIF per Skript, Pages-Build | Gebaut, Deployment ungetestet |
| Lokaler Start mit einem Befehl (`npx github:clschulzer/DeckHack`, `npm start`, `docker compose up`), Pages nur als Landingpage ohne App | Gebaut und getestet, Container-Check in der CI |
| Vorlagenvertrag `templates/README.md` mit automatischer Prüfung | Fertig |
| Erste echte Runde mit Claude, Commit nach GitHub (M1) | Offen, braucht Key und Token |
| Miniaturbilder, Vorher-Nachher-Schieber (M2) | Offen. „Show before/after“ schaltet schon um |
| Aloha-Deck als Beispiel, Adapter-Tests mit echten reveal.js- und Marp-Decks, Screenshot-Action, Ankündigung (M3) | Offen |
| Weitere Vorlagen | Eigener Pull Request |

Was genau getestet ist und was einen echten Key braucht, steht in `docs/TESTING.md`.

| Meilenstein | Inhalt | Fertig, wenn |
| --- | --- | --- |
| M1: Erste echte Runde | Eigenes Repo, Landingpage auf GitHub Pages, Claude und GitHub-Commit mit echten Zugangsdaten durchspielen, Fehler daraus beheben | Auf dem Aloha-Deck wird aus einem Kommentar in unter 60 Sekunden eine geprüfte neue Fassung, und der Commit liegt auf einem Branch |
| M2: Fühlt sich an wie ein Folien-Werkzeug | Miniaturbilder, Kommentar per Klick auf ein Element, Vorher-Nachher-Schieber, Vorlage per KI aus einem Kurzbriefing füllen, Deck per Link öffnen | Eine fremde Person schafft fünf Korrekturen ohne Erklärung |
| M3: Community-Start | Aloha-Deck als Beispiel, fünf Vorlagen, Adapter für reveal.js und Marp mit Testdecks, Screenshot-Action, Ankündigung | Der erste fremde Pull Request ist gemergt |

## Risiken und offene Entscheidungen

Das größte Risiko ist nicht die Technik, sondern dass der erste echte KI-Lauf Überraschungen bringt, die der Demo-Modus nicht zeigen kann.

| Risiko | Einschätzung | Gegenmittel |
| --- | --- | --- |
| Claude-Aufruf aus dem Browser scheitert an Details | Mittel. Der Weg ist für „eigener Key im Browser“ vorgesehen ([Quelle](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access)), aber hier ungetestet | Erster Punkt in M1 |
| Kosten pro Runde bei großen Decks | Niedrig. Das Aloha-Deck hat rund 100 KB Text, geschätzt 30.000 Tokens. Das sind bei Opus 5.5 etwa 12 Cent Eingabe pro Runde, mit Cache deutlich weniger | Vor dem Anwenden die geschätzten Tokens anzeigen |
| Fingerabdruck meldet Änderungen, die keine sind | Mittel bei Decks mit Zufall oder Uhrzeit im Bild. Beim Aloha-Deck stabil | Animationen sind beim Prüfen eingefroren, pro Deck abschaltbar machen |
| Private Repos | Bilder und Videos werden derzeit nur aus öffentlichen Repos geladen | Binärdateien bei privaten Repos über die API holen |
| Key im Browser-Speicher | Niedrig bei Standardeinstellung (nur für den Tab) | Eigene Domain für die gehostete App |
| Decks mit ES-Modulen | Lokale Importe werden noch nicht gebündelt | Import-Map im Bundler ergänzen |

Entschieden: Name „DeckHack“, Repo `clschulzer/DeckHack`, Lizenz MIT. Ob der Name als Marke oder Domain frei ist, ist nicht geprüft.

Noch offen:

- [ ] **Sprache der Oberfläche.** Englisch angenommen, wegen der internationalen Zielgruppe.
