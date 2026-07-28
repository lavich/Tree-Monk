/**
 * Browser stand-in for Node's `path` (POSIX-flavoured, forward slashes),
 * aliased in vite.web.config.ts — enough for the join/basename/extname/dirname
 * calls the shared domain layer makes.
 */

export function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
}

export function basename(p: string, ext?: string): string {
  const base = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return ext && base.toLowerCase().endsWith(ext.toLowerCase())
    ? base.slice(0, base.length - ext.length)
    : base
}

export function extname(p: string): string {
  const base = basename(p)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i) : ''
}

export function dirname(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return i > 0 ? norm.slice(0, i) : '.'
}
