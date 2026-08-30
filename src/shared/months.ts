/** Month names and common abbreviations understood by the date helpers. */
const deaccent = (value: string): string =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const MONTHS: Record<string, number> = {}
const defineMonth = (month: number, ...names: string[]): void => {
  for (const name of names) MONTHS[deaccent(name)] = month
}

defineMonth(1, 'january', 'jan', 'januar', 'jänner', 'január', 'janvier', 'janv', 'gennaio', 'gen', 'genn', 'enero', 'ene', 'январь', 'января', 'янв', 'styczeń', 'stycznia', 'sty', 'janeiro')
defineMonth(2, 'february', 'feb', 'febr', 'februar', 'február', 'février', 'févr', 'fevr', 'fev', 'febbraio', 'febrero', 'февраль', 'февраля', 'luty', 'lutego', 'lut', 'fevereiro', 'fev')
defineMonth(3, 'march', 'mar', 'marc', 'marcius', 'március', 'märz', 'maerz', 'mrz', 'mars', 'marzo', 'март', 'марта', 'marzec', 'marca', 'março')
defineMonth(4, 'april', 'apr', 'aprilis', 'április', 'ápr', 'avr', 'avril', 'aprile', 'abril', 'abr', 'апрель', 'апреля', 'апр', 'kwiecień', 'kwietnia', 'kwi', 'kwiec')
defineMonth(5, 'may', 'maj', 'majus', 'május', 'máj', 'mai', 'maggio', 'mag', 'mayo', 'май', 'мая', 'maja', 'maio')
defineMonth(6, 'june', 'jun', 'junius', 'június', 'juni', 'jún', 'juin', 'giugno', 'giu', 'junio', 'июнь', 'июня', 'июн', 'czerwiec', 'czerwca', 'cze', 'junho')
defineMonth(7, 'july', 'jul', 'julius', 'július', 'juli', 'júl', 'juillet', 'juil', 'luglio', 'lug', 'julio', 'июль', 'июля', 'июл', 'lipiec', 'lipca', 'lip', 'julho')
defineMonth(8, 'august', 'aug', 'augusztus', 'août', 'aout', 'aou', 'agosto', 'ago', 'август', 'августа', 'авг', 'sierpień', 'sierpnia', 'sie', 'sierp')
defineMonth(9, 'september', 'sep', 'sept', 'szeptember', 'szept', 'szep', 'septembre', 'settembre', 'set', 'sett', 'septiembre', 'setiembre', 'сентябрь', 'сентября', 'сен', 'wrzesień', 'września', 'wrz', 'setembro')
defineMonth(10, 'october', 'oct', 'okt', 'oktober', 'október', 'octobre', 'ottobre', 'ott', 'octubre', 'октябрь', 'октября', 'окт', 'październik', 'października', 'paź', 'paz', 'outubro', 'out')
defineMonth(11, 'november', 'nov', 'novembre', 'noviembre', 'ноябрь', 'ноября', 'ноя', 'нояб', 'listopad', 'listopada', 'lis', 'novembro')
defineMonth(12, 'december', 'dec', 'dez', 'dezember', 'décembre', 'decembre', 'déc', 'dicembre', 'dic', 'diciembre', 'декабрь', 'декабря', 'дек', 'grudzień', 'grudnia', 'gru', 'dezembro')

export const monthNumbers: Readonly<Record<string, number>> = MONTHS
export const fuzzyMonthNames: readonly [string, number][] = Object.entries(MONTHS).filter(
  ([name]) => name.length >= 6
)

export function monthNumber(value: string): number | null {
  return monthNumbers[deaccent(value)] ?? null
}
