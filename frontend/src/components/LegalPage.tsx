import { ArrowLeft } from 'lucide-react';
import { LanguageSwitcher, useI18n } from '../i18n/I18nContext';

export type LegalRoute = '/impressum' | '/datenschutz' | '/cookies';

interface LegalPageProps {
  route: LegalRoute;
  onNavigate: (path: '/' | LegalRoute) => void;
}

export function LegalPage({ route, onNavigate }: LegalPageProps) {
  const { lang, t } = useI18n();

  const pageHeading =
    route === '/impressum'
      ? t.legal.tabs.imprint
      : route === '/datenschutz'
      ? t.legal.tabs.privacy
      : t.legal.tabs.cookies;

  const handleLinkClick = (e: React.MouseEvent, target: '/' | LegalRoute) => {
    e.preventDefault();
    onNavigate(target);
  };

  return (
    <div className="min-h-screen bg-ground text-ink flex flex-col">
      <header className="border-b border-line bg-ground">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 py-3.5">
          <div className="flex items-center gap-4">
            <a
              href="/"
              onClick={(e) => handleLinkClick(e, '/')}
              className="font-mono text-sm font-semibold tracking-wider text-ink whitespace-nowrap hover:text-crop transition-colors duration-200 ease-out"
            >
              Terra Tuta
            </a>
            <span className="text-line" aria-hidden="true">
              |
            </span>
            <a
              href="/"
              onClick={(e) => handleLinkClick(e, '/')}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-ink hover:border-crop/50 hover:text-crop transition-colors duration-200 ease-out whitespace-nowrap"
            >
              <ArrowLeft className="h-3 w-3 text-ink-2" aria-hidden="true" />
              <span>{lang === 'de' ? 'Zurück zur Anwendung' : 'Back to app'}</span>
            </a>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[880px] flex-1 px-4 sm:px-6 py-10 space-y-6">
        <div className="space-y-3 border-b border-line pb-5">
          <div className="font-mono text-xs text-crop">
            Terra Tuta · {route}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {pageHeading}
          </h1>
          <div className="border border-warn/35 bg-warn/10 px-3.5 py-2.5 text-xs text-warn leading-relaxed">
            {t.legal.hackathonNote}
          </div>
        </div>

        <article className="space-y-6 text-sm leading-relaxed text-ink-2">
          {route === '/impressum' && (
            <>
              {lang === 'de' ? (
                <>
                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      Angaben gemäß § 5 DDG (Hackathon-Projekt)
                    </h2>
                    <p>
                      <strong className="text-ink">Terra Tuta</strong> (Projektteam / Hackathon-Prototyp 2026)
                      <br />
                      Musterstraße 42
                      <br />
                      52062 Aachen
                      <br />
                      Deutschland
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">Kontakt</h2>
                    <p>
                      E-Mail: kontakt@terra-tuta.example
                      <br />
                      Telefon: +49 (0) 241 0000-2026
                      <br />
                      Projektjahr: 2026
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
                    </h2>
                    <p>
                      Max Mustermann, Erika Musterfrau (Anschrift wie oben)
                      <br />
                      Demo-Registerkennung: Amtsgericht Aachen · Hackathon-Kennung TT-2026-DE
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">Haftungshinweis</h2>
                    <p>
                      Alle Klima-, Boden- und Fruchtfolge-Auswertungen dienen der fachlichen Orientierung im Rahmen eines Hackathon-Prototyps und ersetzen keine standortspezifische Laboruntersuchung oder landwirtschaftliche Fachberatung.
                    </p>
                  </section>
                </>
              ) : (
                <>
                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      Imprint pursuant to § 5 DDG (Germany)
                    </h2>
                    <p>
                      <strong className="text-ink">Terra Tuta</strong> (Hackathon Project Team 2026)
                      <br />
                      Musterstraße 42
                      <br />
                      52062 Aachen
                      <br />
                      Germany
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">Contact</h2>
                    <p>
                      Email: kontakt@terra-tuta.example
                      <br />
                      Phone: +49 (0) 241 0000-2026
                      <br />
                      Year: 2026
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      Editorial Responsibility (§ 18 Abs. 2 MStV)
                    </h2>
                    <p>
                      Max Mustermann, Erika Musterfrau (address as stated above)
                      <br />
                      Demo Registry Placeholder: Local Court Aachen · Hackathon ID TT-2026-DE
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">Disclaimer</h2>
                    <p>
                      Climate trends, soil estimates, and crop rotation comparisons are provided for demonstration and exploratory planning only and do not replace local laboratory soil tests or agronomic advisory services.
                    </p>
                  </section>
                </>
              )}
            </>
          )}

          {route === '/datenschutz' && (
            <>
              {lang === 'de' ? (
                <>
                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      Verantwortliche Stelle (Stand: 2026)
                    </h2>
                    <p>
                      Verantwortlich im Sinne der DSGVO ist das Projektteam{' '}
                      <strong className="text-ink">Terra Tuta</strong>, Musterstraße 42, 52062 Aachen, Deutschland (kontakt@terra-tuta.example).
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      1. Standortwahl, Suche &amp; optionale Ortung
                    </h2>
                    <p>
                      Terra Tuta benötigt kein Benutzerkonto. Wenn Sie einen Ort suchen, Koordinaten eingeben oder auf „Aktuellen Standort nutzen“ klicken, werden die Koordinaten ausschließlich zum Abruf der zugehörigen Klima-, Boden- und Kartendaten verarbeitet. Eine Browser-Standortabfrage erfolgt erst nach Ihrer aktiven Browser-Freigabe.
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      2. Eingebundene Daten- und Kartendienste (Art. 6 Abs. 1 lit. f DSGVO)
                    </h2>
                    <ul className="list-disc pl-5 space-y-1.5">
                      <li>
                        <strong className="text-ink">Mapbox:</strong> Darstellung der interaktiven Vektor- und Satellitenkarten sowie Standort-Hervorhebungen.
                      </li>
                      <li>
                        <strong className="text-ink">NASA POWER &amp; NASA GIBS:</strong> Abruf historischer Klimadaten (1990–2025) und MODIS-Oberflächentemperatur-Ebenen.
                      </li>
                      <li>
                        <strong className="text-ink">ISRIC SoilGrids:</strong> Abruf lokaler Oberboden-Kennwerte (0–30 cm).
                      </li>
                      <li>
                        <strong className="text-ink">Open-Meteo &amp; OpenStreetMap Nominatim:</strong> Ortsnamensuche und Umwandlung von GPS-Koordinaten in Ortsnamen.
                      </li>
                    </ul>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      3. Ihre Rechte nach DSGVO
                    </h2>
                    <p>
                      Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) sowie Widerspruch (Art. 21 DSGVO). Da Terra Tuta keine Nutzerprofile speichert, lassen sich lokale Einstellungen jederzeit über das Löschen des Browser-Speichers entfernen.
                    </p>
                  </section>
                </>
              ) : (
                <>
                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      Controller (2026)
                    </h2>
                    <p>
                      Controller within the meaning of the GDPR is{' '}
                      <strong className="text-ink">Terra Tuta</strong>, Musterstraße 42, 52062 Aachen, Germany (kontakt@terra-tuta.example).
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      1. Location Search &amp; Geolocation
                    </h2>
                    <p>
                      Terra Tuta requires no user account or sign-up. Place queries, manual coordinates, or optional browser geolocation (only triggered when you click “Use current location” and grant permission) are used solely to retrieve weather, soil, and map data for the selected coordinates.
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      2. External Map &amp; Earth-Data Providers (Art. 6(1)(f) GDPR)
                    </h2>
                    <ul className="list-disc pl-5 space-y-1.5">
                      <li>
                        <strong className="text-ink">Mapbox:</strong> Vector/satellite map rendering and spatial site highlighting.
                      </li>
                      <li>
                        <strong className="text-ink">NASA POWER &amp; NASA GIBS:</strong> Historical 1990–2025 climate records and MODIS surface temperature tiles.
                      </li>
                      <li>
                        <strong className="text-ink">ISRIC SoilGrids:</strong> Topsoil properties (0–30 cm).
                      </li>
                      <li>
                        <strong className="text-ink">Open-Meteo &amp; OpenStreetMap Nominatim:</strong> Place search and reverse geocoding.
                      </li>
                    </ul>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      3. Your GDPR Rights
                    </h2>
                    <p>
                      You have the right to access (Art. 15), rectify (Art. 16), erase (Art. 17), restrict (Art. 18), and object to processing (Art. 21 GDPR). Because Terra Tuta stores no backend user profiles, clearing browser storage removes all local state.
                    </p>
                  </section>
                </>
              )}
            </>
          )}

          {route === '/cookies' && (
            <>
              {lang === 'de' ? (
                <>
                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      Keine Werbe- oder Tracking-Cookies (§ 25 TDDDG)
                    </h2>
                    <p>
                      Terra Tuta setzt <strong className="text-ink">keine Werbe-, Analyse- oder Tracking-Cookies</strong> ein. Es findet kein nutzerübergreifendes Tracking statt.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h2 className="text-base font-semibold text-ink">
                      Technisch notwendiger Browser-Speicher (Local Storage)
                    </h2>
                    <div className="border border-line bg-panel divide-y divide-line text-xs">
                      <div className="p-3.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="font-mono text-ink">terratuta_cookie_consent_v1</span>
                        <span className="text-ink-2">
                          Speichert, dass Sie diesen Datenschutz- und Cookie-Hinweis bestätigt haben.
                        </span>
                      </div>
                      <div className="p-3.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="font-mono text-ink">Sprachwahl (DE / EN)</span>
                        <span className="text-ink-2">
                          Hält die gewählte Anzeigesprache während der Sitzung bereit.
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">Verwaltung &amp; Löschung</h2>
                    <p>
                      Sie können gespeicherte Einträge jederzeit in den Datenschutzeinstellungen Ihres Browsers löschen. Beim nächsten Aufruf erscheint der Hinweis erneut.
                    </p>
                  </section>
                </>
              ) : (
                <>
                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">
                      No Advertising or Tracking Cookies (§ 25 TDDDG)
                    </h2>
                    <p>
                      Terra Tuta sets <strong className="text-ink">no advertising, analytics, or cross-site tracking cookies</strong>.
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h2 className="text-base font-semibold text-ink">
                      Strictly Necessary Browser Storage
                    </h2>
                    <div className="border border-line bg-panel divide-y divide-line text-xs">
                      <div className="p-3.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="font-mono text-ink">terratuta_cookie_consent_v1</span>
                        <span className="text-ink-2">
                          Records acknowledgment of this privacy and cookie notice.
                        </span>
                      </div>
                      <div className="p-3.5 flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="font-mono text-ink">Language preference (DE / EN)</span>
                        <span className="text-ink-2">
                          Keeps your selected interface language active.
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-1.5">
                    <h2 className="text-base font-semibold text-ink">Managing Storage</h2>
                    <p>
                      You can clear stored browser data at any time via your browser privacy settings.
                    </p>
                  </section>
                </>
              )}
            </>
          )}
        </article>
      </main>

      <footer className="border-t border-line bg-ground py-4">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-ink-3">
          <span>{t.footer.left}</span>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/impressum"
              onClick={(e) => handleLinkClick(e, '/impressum')}
              className={`transition-colors duration-200 ease-out ${
                route === '/impressum' ? 'text-crop font-medium' : 'hover:text-ink'
              }`}
            >
              {t.footer.imprint}
            </a>
            <a
              href="/datenschutz"
              onClick={(e) => handleLinkClick(e, '/datenschutz')}
              className={`transition-colors duration-200 ease-out ${
                route === '/datenschutz' ? 'text-crop font-medium' : 'hover:text-ink'
              }`}
            >
              {t.footer.privacy}
            </a>
            <a
              href="/cookies"
              onClick={(e) => handleLinkClick(e, '/cookies')}
              className={`transition-colors duration-200 ease-out ${
                route === '/cookies' ? 'text-crop font-medium' : 'hover:text-ink'
              }`}
            >
              {t.footer.cookies}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
