/** Common religion / denomination suggestions for the religion field, localized
 *  to the UI language. Shown in a <datalist> — the field stays free-text, these
 *  are just quick-pick options. */
const LISTS: Record<string, string[]> = {
  hu: [
    'Római katolikus',
    'Görögkatolikus',
    'Református',
    'Evangélikus',
    'Izraelita',
    'Ortodox',
    'Unitárius',
    'Baptista',
    'Metodista',
    'Adventista',
    'Pünkösdi',
    'Felekezeten kívüli'
  ],
  de: [
    'Römisch-katholisch',
    'Griechisch-katholisch',
    'Evangelisch',
    'Evangelisch-lutherisch',
    'Reformiert',
    'Jüdisch',
    'Orthodox',
    'Unitarisch',
    'Baptisten',
    'Methodisten',
    'Adventisten',
    'Pfingstler',
    'Konfessionslos'
  ],
  en: [
    'Roman Catholic',
    'Greek Catholic',
    'Protestant',
    'Lutheran',
    'Reformed / Calvinist',
    'Jewish',
    'Orthodox',
    'Unitarian',
    'Baptist',
    'Methodist',
    'Adventist',
    'Pentecostal',
    'None'
  ],
  fr: [
    'Catholique romaine',
    'Catholique grecque',
    'Protestante',
    'Luthérienne',
    'Réformée / calviniste',
    'Juive',
    'Orthodoxe',
    'Unitarienne',
    'Baptiste',
    'Méthodiste',
    'Adventiste',
    'Pentecôtiste',
    'Sans religion'
  ],
  it: [
    'Cattolica romana',
    'Greco-cattolica',
    'Protestante',
    'Luterana',
    'Riformata / calvinista',
    'Ebraica',
    'Ortodossa',
    'Unitariana',
    'Battista',
    'Metodista',
    'Avventista',
    'Pentecostale',
    'Nessuna religione'
  ],
  es: [
    'Católica romana',
    'Greco-católica',
    'Protestante',
    'Luterana',
    'Reformada / calvinista',
    'Judía',
    'Ortodoxa',
    'Unitaria',
    'Bautista',
    'Metodista',
    'Adventista',
    'Pentecostal',
    'Sin religión'
  ],
  ru: [
    'Римско-католическая',
    'Греко-католическая',
    'Протестантская',
    'Лютеранская',
    'Реформатская / кальвинистская',
    'Иудейская',
    'Православная',
    'Унитарианская',
    'Баптистская',
    'Методистская',
    'Адвентистская',
    'Пятидесятническая',
    'Без религии'
  ],
  pl: [
    'Rzymskokatolickie',
    'Greckokatolickie',
    'Protestanckie',
    'Luterańskie',
    'Reformowane / kalwińskie',
    'Żydowskie',
    'Prawosławne',
    'Unitariańskie',
    'Baptystyczne',
    'Metodystyczne',
    'Adwentystyczne',
    'Zielonoświątkowe',
    'Bezwyznaniowe'
  ],
  pt: [
    'Católica romana',
    'Greco-católica',
    'Protestante',
    'Luterana',
    'Reformada / calvinista',
    'Judaica',
    'Ortodoxa',
    'Unitária',
    'Batista',
    'Metodista',
    'Adventista',
    'Pentecostal',
    'Sem religião'
  ]
}

export function religionOptions(lang: string): string[] {
  return LISTS[(lang || 'en').slice(0, 2)] ?? LISTS.en
}
