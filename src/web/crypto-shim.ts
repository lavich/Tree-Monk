// Browser stand-in for Node's `crypto` module. The repository layer imports
// `randomUUID` (Web Crypto provides the same API) and mediaId.ts imports
// `createHash('sha1')` for deterministic media document ids — served here by a
// small pure-JS SHA-1 (Web Crypto's digest is async; the callers are sync).
export function randomUUID(): string {
  return globalThis.crypto.randomUUID()
}

/** Minimal synchronous SHA-1, API-compatible with createHash('sha1')…digest('hex'). */
function sha1Hex(message: string): string {
  const utf8 = new TextEncoder().encode(message)
  const ml = utf8.length
  const withOne = ml + 1
  const totalLen = Math.ceil((withOne + 8) / 64) * 64
  const bytes = new Uint8Array(totalLen)
  bytes.set(utf8)
  bytes[ml] = 0x80
  const bitLen = ml * 8
  new DataView(bytes.buffer).setUint32(totalLen - 4, bitLen >>> 0, false)
  new DataView(bytes.buffer).setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false)

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  const view = new DataView(bytes.buffer)
  const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0
  for (let i = 0; i < totalLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false)
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1)
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4]
    for (let j = 0; j < 80; j++) {
      const [f, k] =
        j < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : j < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : j < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6]
      const t = (rotl(a, 5) + (f >>> 0) + e + k + w[j]) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = t
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('')
}

export function createHash(_algorithm: string): {
  update(data: string): { digest(encoding: 'hex'): string }
} {
  return {
    update(data: string) {
      return { digest: () => sha1Hex(data) }
    }
  }
}
