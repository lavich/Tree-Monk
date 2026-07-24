import { readFileSync } from 'fs'
import { People } from './db/repo'
import type { PersonInput, Sex } from '@shared/types'

/**
 * Bulk person import from CSV — Excel-friendly: the delimiter (`,` `;` tab) is
 * auto-detected from the header line, quoted fields are handled, and the
 * columns are recognised by their header names in Hungarian, English and
 * German. Rows without any name are skipped. Only PEOPLE are created (no
 * relationships) — the point is fast mass entry from a spreadsheet.
 */

/** Column keys we can fill from a CSV. */
type Col =
  | 'surname'
  | 'given'
  | 'fullName'
  | 'sex'
  | 'birthDate'
  | 'birthPlace'
  | 'deathDate'
  | 'deathPlace'
  | 'occupation'
  | 'notes'
  | 'callName'
  | 'religion'

/** Header → column key, tried in order (first match wins). */
const HEADER_PATTERNS: [Col, RegExp][] = [
  ['surname', /vezet[ée]kn[ée]v|csal[áa]dn[ée]v|nachname|familienname|surname|last\s*name|lastname|family\s*name/i],
  ['given', /keresztn[ée]v|ut[óo]n[ée]v|vorname|given|first\s*name|firstname/i],
  ['callName', /h[íi]v[óo]n[ée]v|rufname|call\s*name/i],
  ['sex', /\bnem\b|geschlecht|gender|\bsex\b/i],
  ['birthDate', /sz[üu]let[ée]si?\s*(d[áa]tum|id[őo])|sz[üu]letett|geburtsdatum|birth\s*date|birthdate|\bborn\b/i],
  ['birthPlace', /sz[üu]let[ée]si?\s*hely|geburtsort|birth\s*place|birthplace/i],
  ['deathDate', /hal[áa]l\w*\s*(d[áa]tum|id[őo])?|elhunyt|meghalt|sterbedatum|todesdatum|death\s*date|deathdate|\bdied\b/i],
  ['deathPlace', /hal[áa]lozási\s*hely|sterbeort|death\s*place|deathplace/i],
  ['occupation', /foglalkoz[áa]s|beruf|occupation|profession/i],
  ['religion', /vall[áa]s|konfession|religion/i],
  ['notes', /megjegyz[ée]s|jegyzet|notiz|bemerkung|note/i],
  // Generic full-name column LAST, so it never shadows surname/given columns.
  ['fullName', /^n[ée]v$|^name$|teljes\s*n[ée]v|full\s*name/i]
]

function mapSex(raw: string): Sex {
  const s = raw.trim().toLowerCase()
  if (/^(f|female|n[őo]|w|weiblich|frau)$/.test(s)) return 'F'
  if (/^(m|male|f[ée]rfi|ffi|m[äa]nnlich|mann)$/.test(s)) return 'M'
  return 'U'
}

/**
 * RFC-4180-ish parser over the WHOLE text: a quoted field may contain the
 * delimiter, quotes (doubled) AND newlines, so splitting on lines first would
 * corrupt an Excel export whose cell holds a multi-line note. Returns records
 * of trimmed cells; fully-empty records are dropped by the caller.
 */
function parseRecords(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(cur)
      cur = ''
    } else if (ch === '\r') {
      // ignore — newlines are driven by \n
    } else if (ch === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  row.push(cur)
  rows.push(row)
  return rows.map((r) => r.map((c) => c.trim()))
}

export function importCsvText(text: string): { created: number; skipped: number } {
  const clean = text.replace(/^﻿/, '') // strip a BOM (Excel writes one)
  // Delimiter: whichever of ; , tab appears most on the header (first) line.
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ''
  const delim = [';', ',', '\t']
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d

  // Quote-aware parse of the whole file, then drop fully-empty records.
  const records = parseRecords(clean, delim).filter((r) => r.some((c) => c.length > 0))
  if (records.length < 2) return { created: 0, skipped: 0 }

  const headers = records[0]
  const colOf = new Map<number, Col>()
  const taken = new Set<Col>()
  headers.forEach((h, i) => {
    for (const [col, re] of HEADER_PATTERNS) {
      if (taken.has(col)) continue
      if (re.test(h)) {
        colOf.set(i, col)
        taken.add(col)
        return
      }
    }
  })
  // A lone "name" column only counts when no explicit surname/given exists.
  if ((taken.has('surname') || taken.has('given')) && taken.has('fullName')) {
    for (const [i, c] of colOf) if (c === 'fullName') colOf.delete(i)
  }

  let created = 0
  let skipped = 0
  for (const cells of records.slice(1)) {
    const val = (c: Col): string => {
      for (const [i, col] of colOf) if (col === c) return cells[i] ?? ''
      return ''
    }
    let surname = val('surname')
    let given = val('given')
    if (!surname && !given) {
      const full = val('fullName').trim()
      if (full.includes(',')) {
        // "Kovács, János" → surname, given.
        const [a, b] = full.split(',', 2)
        surname = a.trim()
        given = (b ?? '').trim()
      } else if (full) {
        // Hungarian order: family name first, the rest are given names.
        const parts = full.split(/\s+/)
        surname = parts[0]
        given = parts.slice(1).join(' ')
      }
    }
    if (!surname && !given) {
      skipped++
      continue
    }
    const input: PersonInput = {
      surname,
      givenName: given,
      sex: taken.has('sex') ? mapSex(val('sex')) : 'U',
      birthDate: val('birthDate') || null,
      birthPlace: val('birthPlace') || null,
      deathDate: val('deathDate') || null,
      deathPlace: val('deathPlace') || null,
      occupation: val('occupation') || null,
      religion: val('religion') || null,
      callName: val('callName') || null,
      notes: val('notes') || null
    }
    // One malformed row must not abort the whole bulk import.
    try {
      People.create(input)
      created++
    } catch {
      skipped++
    }
  }
  return { created, skipped }
}

export function importCsvFile(filePath: string): { created: number; skipped: number } {
  return importCsvText(readFileSync(filePath, 'utf-8'))
}
