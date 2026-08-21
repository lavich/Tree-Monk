import { describe, expect, it } from 'vitest'
import i18n, { LANGUAGES } from '@/i18n'

// Russian needs four cardinal plural forms where English has two, and a single
// ordinal form where English has four. i18next derives that from the language
// code, so these tests fail loudly if a key set drifts back to the English shape.

describe('Russian locale', () => {
  it('is offered in the language switcher', () => {
    expect(LANGUAGES.map((l) => l.code)).toContain('ru')
  })

  it('resolves Russian strings', async () => {
    await i18n.changeLanguage('ru')
    expect(i18n.t('nav.tree')).toBe('Родословное дерево')
  })

  it('picks the right cardinal plural form', async () => {
    await i18n.changeLanguage('ru')
    expect(i18n.t('collapse.found', { count: 1 })).toBe('1 повторяющийся предок')
    expect(i18n.t('collapse.found', { count: 3 })).toBe('3 повторяющихся предка')
    expect(i18n.t('collapse.found', { count: 7 })).toBe('7 повторяющихся предков')
    expect(i18n.t('collapse.found', { count: 21 })).toBe('21 повторяющийся предок')
  })

  it('uses the single Russian ordinal form', async () => {
    await i18n.changeLanguage('ru')
    for (const count of [1, 2, 3, 11]) {
      expect(i18n.t('person.marriageOrdinal', { count, ordinal: true })).toBe(`${count}-й брак`)
    }
  })
})
