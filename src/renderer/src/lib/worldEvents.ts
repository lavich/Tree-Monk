/**
 * A curated set of major historical events — Hungary-centric, then Europe and the
 * wider world — that a person likely lived through. Used for the map's "world
 * events" section and the profile timeline. Offline & reliable (Wikidata's live
 * queries time out and large events like the World Wars carry no single
 * coordinate, so a hand-picked list is both faster and more relevant here).
 *
 * `to` is the end year for spans (wars, eras); omit it for point events.
 */
export type EventScope = 'hungary' | 'europe' | 'world'

export interface WorldEvent {
  from: number
  to?: number
  scope: EventScope
  hu: string
  en: string
  de: string
  fr: string
  it: string
  es: string
  ru: string
  pl: string
  pt: string
}

const EVENTS: WorldEvent[] = [
  { from: 1492, scope: 'world', hu: 'Kolumbusz eléri Amerikát', en: 'Columbus reaches the Americas', de: 'Kolumbus erreicht Amerika', fr: 'Christophe Colomb atteint les Amériques', it: 'Colombo raggiunge le Americhe', es: 'Colón llega a América', ru: 'Колумб достигает Америки', pl: 'Kolumb dociera do Ameryki', pt: 'Colombo chega às Américas' },
  { from: 1517, scope: 'europe', hu: 'A reformáció kezdete', en: 'The Reformation begins', de: 'Beginn der Reformation', fr: 'Début de la Réforme', it: 'Inizio della Riforma', es: 'Comienzo de la Reforma', ru: 'Начало Реформации', pl: 'Początek reformacji', pt: 'Início da Reforma' },
  { from: 1526, scope: 'hungary', hu: 'Mohácsi csata', en: 'Battle of Mohács', de: 'Schlacht bei Mohács', fr: 'Bataille de Mohács', it: 'Battaglia di Mohács', es: 'Batalla de Mohács', ru: 'Битва при Мохаче', pl: 'Bitwa pod Mohaczem', pt: 'Batalha de Mohács' },
  { from: 1541, to: 1699, scope: 'hungary', hu: 'Török hódoltság', en: 'Ottoman rule in Hungary', de: 'Osmanische Herrschaft in Ungarn', fr: 'Occupation ottomane de la Hongrie', it: 'Dominio ottomano in Ungheria', es: 'Dominio otomano en Hungría', ru: 'Османское владычество в Венгрии', pl: 'Panowanie osmańskie na Węgrzech', pt: 'Domínio otomano na Hungria' },
  { from: 1618, to: 1648, scope: 'europe', hu: 'Harmincéves háború', en: "Thirty Years' War", de: 'Dreißigjähriger Krieg', fr: 'Guerre de Trente Ans', it: 'Guerra dei Trent’anni', es: 'Guerra de los Treinta Años', ru: 'Тридцатилетняя война', pl: 'Wojna trzydziestoletnia', pt: 'Guerra dos Trinta Anos' },
  { from: 1683, scope: 'hungary', hu: 'Bécs ostroma', en: 'Siege of Vienna', de: 'Zweite Wiener Türkenbelagerung', fr: 'Siège de Vienne', it: 'Assedio di Vienna', es: 'Sitio de Viena', ru: 'Осада Вены', pl: 'Odsiecz wiedeńska', pt: 'Cerco de Viena' },
  { from: 1686, scope: 'hungary', hu: 'Buda visszafoglalása', en: 'Recapture of Buda', de: 'Rückeroberung von Buda', fr: 'Reprise de Buda', it: 'Riconquista di Buda', es: 'Reconquista de Buda', ru: 'Взятие Буды', pl: 'Odbicie Budy', pt: 'Reconquista de Buda' },
  { from: 1703, to: 1711, scope: 'hungary', hu: 'Rákóczi-szabadságharc', en: "Rákóczi's War of Independence", de: 'Rákóczi-Aufstand', fr: 'Guerre d’indépendance de Rákóczi', it: 'Guerra d’indipendenza di Rákóczi', es: 'Guerra de independencia de Rákóczi', ru: 'Освободительная война Ракоци', pl: 'Powstanie Rakoczego', pt: 'Guerra de independência de Rákóczi' },
  { from: 1709, to: 1713, scope: 'europe', hu: 'Nagy pestisjárvány', en: 'Great Plague outbreak', de: 'Große Pestepidemie', fr: 'Grande épidémie de peste', it: 'Grande epidemia di peste', es: 'Gran epidemia de peste', ru: 'Великая эпидемия чумы', pl: 'Wielka epidemia dżumy', pt: 'Grande epidemia de peste' },
  { from: 1740, to: 1748, scope: 'europe', hu: 'Osztrák örökösödési háború', en: 'War of the Austrian Succession', de: 'Österreichischer Erbfolgekrieg', fr: 'Guerre de Succession d’Autriche', it: 'Guerra di successione austriaca', es: 'Guerra de sucesión austriaca', ru: 'Война за австрийское наследство', pl: 'Wojna o sukcesję austriacką', pt: 'Guerra da Sucessão Austríaca' },
  { from: 1756, to: 1763, scope: 'europe', hu: 'Hétéves háború', en: "Seven Years' War", de: 'Siebenjähriger Krieg', fr: 'Guerre de Sept Ans', it: 'Guerra dei Sette Anni', es: 'Guerra de los Siete Años', ru: 'Семилетняя война', pl: 'Wojna siedmioletnia', pt: 'Guerra dos Sete Anos' },
  { from: 1776, scope: 'world', hu: 'Amerikai függetlenségi nyilatkozat', en: 'US Declaration of Independence', de: 'Amerikanische Unabhängigkeitserklärung', fr: 'Déclaration d’indépendance des États-Unis', it: 'Dichiarazione d’indipendenza degli Stati Uniti', es: 'Declaración de Independencia de los Estados Unidos', ru: 'Декларация независимости США', pl: 'Deklaracja niepodległości USA', pt: 'Declaração de Independência dos EUA' },
  { from: 1789, to: 1799, scope: 'europe', hu: 'Francia forradalom', en: 'French Revolution', de: 'Französische Revolution', fr: 'Révolution française', it: 'Rivoluzione francese', es: 'Revolución francesa', ru: 'Великая французская революция', pl: 'Rewolucja francuska', pt: 'Revolução Francesa' },
  { from: 1803, to: 1815, scope: 'europe', hu: 'Napóleoni háborúk', en: 'Napoleonic Wars', de: 'Napoleonische Kriege', fr: 'Guerres napoléoniennes', it: 'Guerre napoleoniche', es: 'Guerras napoleónicas', ru: 'Наполеоновские войны', pl: 'Wojny napoleońskie', pt: 'Guerras Napoleônicas' },
  { from: 1831, scope: 'hungary', hu: 'Nagy kolerajárvány', en: 'Major cholera epidemic', de: 'Große Choleraepidemie', fr: 'Grande épidémie de choléra', it: 'Grande epidemia di colera', es: 'Gran epidemia de cólera', ru: 'Крупная эпидемия холеры', pl: 'Wielka epidemia cholery', pt: 'Grande epidemia de cólera' },
  { from: 1848, to: 1849, scope: 'hungary', hu: 'Magyar forradalom és szabadságharc', en: 'Hungarian Revolution of 1848', de: 'Ungarische Revolution 1848', fr: 'Révolution hongroise de 1848', it: 'Rivoluzione ungherese del 1848', es: 'Revolución húngara de 1848', ru: 'Венгерская революция 1848—1849 годов', pl: 'Rewolucja węgierska 1848', pt: 'Revolução Húngara de 1848' },
  { from: 1853, to: 1856, scope: 'europe', hu: 'Krími háború', en: 'Crimean War', de: 'Krimkrieg', fr: 'Guerre de Crimée', it: 'Guerra di Crimea', es: 'Guerra de Crimea', ru: 'Крымская война', pl: 'Wojna krymska', pt: 'Guerra da Crimeia' },
  { from: 1861, to: 1865, scope: 'world', hu: 'Amerikai polgárháború', en: 'American Civil War', de: 'Amerikanischer Bürgerkrieg', fr: 'Guerre de Sécession', it: 'Guerra civile americana', es: 'Guerra de Secesión', ru: 'Гражданская война в США', pl: 'Wojna secesyjna', pt: 'Guerra de Secessão' },
  { from: 1866, scope: 'europe', hu: 'Porosz–osztrák háború', en: 'Austro-Prussian War', de: 'Deutsch-Österreichischer Krieg', fr: 'Guerre austro-prussienne', it: 'Guerra austro-prussiana', es: 'Guerra austro-prusiana', ru: 'Австро-прусская война', pl: 'Wojna prusko-austriacka', pt: 'Guerra Austro-Prussiana' },
  { from: 1867, scope: 'hungary', hu: 'A kiegyezés (Osztrák–Magyar Monarchia)', en: 'Austro-Hungarian Compromise', de: 'Österreichisch-Ungarischer Ausgleich', fr: 'Compromis austro-hongrois', it: 'Compromesso austro-ungarico', es: 'Compromiso austrohúngaro', ru: 'Австро-венгерское соглашение 1867 года', pl: 'Ugoda austriacko-węgierska', pt: 'Compromisso Austro-Húngaro' },
  { from: 1870, to: 1871, scope: 'europe', hu: 'Porosz–francia háború', en: 'Franco-Prussian War', de: 'Deutsch-Französischer Krieg', fr: 'Guerre franco-prussienne', it: 'Guerra franco-prussiana', es: 'Guerra franco-prusiana', ru: 'Франко-прусская война', pl: 'Wojna francusko-pruska', pt: 'Guerra Franco-Prussiana' },
  { from: 1873, scope: 'hungary', hu: 'Budapest egyesítése', en: 'Unification of Budapest', de: 'Vereinigung von Budapest', fr: 'Unification de Budapest', it: 'Unificazione di Budapest', es: 'Unificación de Budapest', ru: 'Объединение Будапешта', pl: 'Zjednoczenie Budapesztu', pt: 'Unificação de Budapeste' },
  { from: 1873, scope: 'hungary', hu: 'Kolerajárvány', en: 'Cholera epidemic', de: 'Choleraepidemie', fr: 'Épidémie de choléra', it: 'Epidemia di colera', es: 'Epidemia de cólera', ru: 'Эпидемия холеры', pl: 'Epidemia cholery', pt: 'Epidemia de cólera' },
  { from: 1914, to: 1918, scope: 'world', hu: 'Első világháború', en: 'World War I', de: 'Erster Weltkrieg', fr: 'Première Guerre mondiale', it: 'Prima guerra mondiale', es: 'Primera Guerra Mundial', ru: 'Первая мировая война', pl: 'I wojna światowa', pt: 'Primeira Guerra Mundial' },
  { from: 1918, to: 1920, scope: 'world', hu: 'Spanyolnátha-járvány', en: 'Spanish flu pandemic', de: 'Spanische Grippe', fr: 'Pandémie de grippe espagnole', it: 'Pandemia di influenza spagnola', es: 'Pandemia de gripe española', ru: 'Пандемия испанского гриппа', pl: 'Pandemia grypy hiszpanki', pt: 'Pandemia de gripe espanhola' },
  { from: 1918, scope: 'hungary', hu: 'Őszirózsás forradalom', en: 'Aster Revolution', de: 'Asternrevolution', fr: 'Révolution des Asters', it: 'Rivoluzione dei crisantemi', es: 'Revolución de los crisantemos', ru: 'Революция астр', pl: 'Rewolucja astrów', pt: 'Revolução dos Crisântemos' },
  { from: 1919, scope: 'hungary', hu: 'Tanácsköztársaság', en: 'Hungarian Soviet Republic', de: 'Ungarische Räterepublik', fr: 'République des conseils de Hongrie', it: 'Repubblica sovietica ungherese', es: 'República Soviética Húngara', ru: 'Венгерская советская республика', pl: 'Węgierska Republika Rad', pt: 'República Soviética Húngara' },
  { from: 1920, scope: 'hungary', hu: 'Trianoni békeszerződés', en: 'Treaty of Trianon', de: 'Vertrag von Trianon', fr: 'Traité de Trianon', it: 'Trattato del Trianon', es: 'Tratado de Trianon', ru: 'Трианонский договор', pl: 'Traktat w Trianon', pt: 'Tratado de Trianon' },
  { from: 1929, to: 1933, scope: 'world', hu: 'Nagy gazdasági világválság', en: 'Great Depression', de: 'Weltwirtschaftskrise', fr: 'Grande Dépression', it: 'Grande depressione', es: 'Gran Depresión', ru: 'Великая депрессия', pl: 'Wielki kryzys', pt: 'Grande Depressão' },
  { from: 1939, to: 1945, scope: 'world', hu: 'Második világháború', en: 'World War II', de: 'Zweiter Weltkrieg', fr: 'Seconde Guerre mondiale', it: 'Seconda guerra mondiale', es: 'Segunda Guerra Mundial', ru: 'Вторая мировая война', pl: 'II wojna światowa', pt: 'Segunda Guerra Mundial' },
  { from: 1944, scope: 'hungary', hu: 'Holokauszt Magyarországon', en: 'The Holocaust in Hungary', de: 'Holocaust in Ungarn', fr: 'Holocauste en Hongrie', it: 'Olocausto in Ungheria', es: 'Holocausto en Hungría', ru: 'Холокост в Венгрии', pl: 'Holokaust na Węgrzech', pt: 'Holocausto na Hungria' },
  { from: 1948, to: 1989, scope: 'hungary', hu: 'Kommunista diktatúra', en: 'Communist dictatorship', de: 'Kommunistische Diktatur', fr: 'Dictature communiste', it: 'Dittatura comunista', es: 'Dictadura comunista', ru: 'Коммунистическая диктатура', pl: 'Dyktatura komunistyczna', pt: 'Ditadura comunista' },
  { from: 1956, scope: 'hungary', hu: 'Az 1956-os forradalom', en: 'Hungarian Revolution of 1956', de: 'Ungarischer Volksaufstand 1956', fr: 'Révolution hongroise de 1956', it: 'Rivoluzione ungherese del 1956', es: 'Revolución húngara de 1956', ru: 'Венгерское восстание 1956 года', pl: 'Powstanie węgierskie 1956', pt: 'Revolução Húngara de 1956' },
  { from: 1989, scope: 'hungary', hu: 'Rendszerváltás', en: 'Fall of Communism', de: 'Wende (Ende des Kommunismus)', fr: 'Chute du communisme', it: 'Caduta del comunismo', es: 'Caída del comunismo', ru: 'Смена политического строя', pl: 'Upadek komunizmu', pt: 'Queda do comunismo' },
  { from: 1991, scope: 'world', hu: 'A Szovjetunió felbomlása', en: 'Dissolution of the Soviet Union', de: 'Auflösung der Sowjetunion', fr: 'Dissolution de l’Union soviétique', it: 'Dissoluzione dell’Unione Sovietica', es: 'Disolución de la Unión Soviética', ru: 'Распад Советского Союза', pl: 'Rozpad Związku Radzieckiego', pt: 'Dissolução da União Soviética' },
  { from: 2004, scope: 'hungary', hu: 'Magyarország uniós csatlakozása', en: 'Hungary joins the EU', de: 'Ungarn tritt der EU bei', fr: 'Adhésion de la Hongrie à l’Union européenne', it: 'Adesione dell’Ungheria all’Unione europea', es: 'Adhesión de Hungría a la Unión Europea', ru: 'Вступление Венгрии в Евросоюз', pl: 'Węgry wstępują do UE', pt: 'Adesão da Hungria à União Europeia' }
]

/** Major events overlapping [fromYear, toYear], oldest first. */
export function worldEventsInRange(fromYear: number, toYear: number): WorldEvent[] {
  return EVENTS.filter((e) => e.from <= toYear && (e.to ?? e.from) >= fromYear).sort((a, b) => a.from - b.from)
}

/** Localised title in any supported UI language (English fallback). */
export function worldEventTitle(e: WorldEvent, lang: string): string {
  if (lang.startsWith('hu')) return e.hu
  if (lang.startsWith('de')) return e.de
  if (lang.startsWith('fr')) return e.fr
  if (lang.startsWith('it')) return e.it
  if (lang.startsWith('es')) return e.es
  if (lang.startsWith('ru')) return e.ru
  if (lang.startsWith('pl')) return e.pl
  if (lang.startsWith('pt')) return e.pt
  return e.en
}

/** "1914–1918" or "1526". */
export function worldEventYears(e: WorldEvent): string {
  return e.to && e.to !== e.from ? `${e.from}–${e.to}` : `${e.from}`
}
