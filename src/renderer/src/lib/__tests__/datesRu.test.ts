import { describe, it, expect } from 'vitest'
import { formatDisplayDate, normalizeDate } from '@/lib/dates'
import { parts } from '@/lib/calendar'

// Russian month names and date qualifiers. Two separate month tables have to
// agree: dates.ts looks tokens up AFTER deaccent() (which turns "май" into
// "маи"), calendar.ts only lowercases them — so both spellings are covered.

describe('normalizeDate with Russian month names', () => {
  it('reads the genitive form used in running dates', () => {
    expect(normalizeDate('12 января 1992')).toBe('1992-01-12')
    expect(normalizeDate('17 мая 1923')).toBe('1923-05-17')
    expect(normalizeDate('3 сентября 1877')).toBe('1877-09-03')
  })

  it('reads the nominative form and month-only dates', () => {
    expect(normalizeDate('1992. январь 12')).toBe('1992-01-12')
    expect(normalizeDate('май 1900')).toBe('1900-05')
  })

  it('still reads Roman-numeral months from old church records', () => {
    expect(normalizeDate('1850. VII. 12.')).toBe('1850-07-12')
  })
})

describe('normalizeDate with Russian qualifiers', () => {
  it('canonicalises word qualifiers', () => {
    expect(normalizeDate('ок. 1850')).toBe('ABT 1850')
    expect(normalizeDate('до 1850')).toBe('BEF 1850')
    expect(normalizeDate('после 1850')).toBe('AFT 1850')
    expect(normalizeDate('между 1850 и 1860')).toBe('BET 1850 AND 1860')
  })

  it('does not mistake "октябрь" for the "ок." qualifier', () => {
    expect(normalizeDate('октябрь 1850')).toBe('1850-10')
  })
})

describe('formatDisplayDate in Russian', () => {
  it('wraps qualified dates in the Russian affix', () => {
    expect(formatDisplayDate('ABT 1850', 'iso', 'ru')).toBe('ок. 1850')
    expect(formatDisplayDate('BEF 1850', 'iso', 'ru')).toBe('до 1850')
    expect(formatDisplayDate('AFT 1850', 'iso', 'ru')).toBe('после 1850')
    expect(formatDisplayDate('BET 1850 AND 1860', 'iso', 'ru')).toBe('между 1850 и 1860')
  })
})

describe('calendar parts with Russian month names', () => {
  it('pulls Y/M/D out of a Russian date', () => {
    expect(parts('12 января 1992')).toEqual({ y: 1992, mo: 1, d: 12 })
    expect(parts('17 мая 1923')).toEqual({ y: 1923, mo: 5, d: 17 })
  })
})
