/* ProjectLedger crypto helpers: SHA-256 report hash, MinHash similarity fingerprint,
 * overlap highlighting and the privacy-preserving team hash.
 * Works in the browser (window.ProjectLedgerCrypto) and in Node (require), so that
 * blockchain/scripts/deploy.js seeds exactly the same records as the web app.
 *
 * MinHash fingerprint (documented so that every college computes the same one):
 *   1. Normalise: Unicode letters/digits only, lower case, drop common stop words.
 *   2. Shingles: every run of 3 consecutive remaining words ("soil moisture probe").
 *   3. Base hash: x = FNV-1a 32-bit of the shingle's UTF-8 bytes.
 *   4. 32 hash functions h_i(x) = (a_i * x + b_i) mod P, with P = 4294967311 (the
 *      smallest prime above 2^32) and a_i, b_i drawn from the PRNG mulberry32(22743).
 *   5. Signature slot i = min over all shingles of h_i(x), kept as uint32.
 *   6. On-chain fingerprint = the 32 slots as big-endian uint32 = 128 bytes.
 *   Similarity estimate = (number of equal slots) / 32  ≈  Jaccard(shingles A, shingles B).
 *   With 32 slots the standard error is about ±0.09, so 0.5 or more is reported as a
 *   near-duplicate and the exact Jaccard is shown whenever both texts are available.
 */
(function (root) {
  const NUM_HASHES = 32;
  const SHINGLE = 3;
  const NEAR_DUP = 0.5; // MinHash similarity at or above which a report is a near-duplicate
  const RELATED = 0.25; // shown as "related" (shared passages worth a look)
  const FINGERPRINT_BYTES = NUM_HASHES * 4;
  const P = 4294967311n;
  const TWO32 = 4294967296n;
  const MAX_TEXT = 200000; // characters; reports are text, a few KB each

  const STOP = new Set(
    ("a an the and or nor of to in on at for from by with as is are was were be been being it its this that these those " +
      "we our us you your they their them he she his her i me my which who whom whose what when where while so than then there " +
      "also can could would should will shall may might must only not no but if into onto over under about each every all any " +
      "more most very has have had do does did such per after before between up down out off").split(" ")
  );

  // ---------- deterministic hash family ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0);
    };
  }
  const COEFF = (() => {
    const rnd = mulberry32(22743);
    const out = [];
    for (let i = 0; i < NUM_HASHES; i++) {
      const a = BigInt(rnd() || 1); // a_i must not be 0
      const b = BigInt(rnd());
      out.push([a, b]);
    }
    return out;
  })();

  const enc = new TextEncoder();
  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (const byte of enc.encode(str)) {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // ---------- text analysis ----------
  const normalizeReport = (text) => String(text || "").replace(/\r\n?/g, "\n").trim();

  /** Content words with their character spans in the original text. */
  function tokens(text) {
    const out = [];
    const re = /[\p{L}\p{N}]+/gu;
    let m;
    while ((m = re.exec(text))) {
      const w = m[0].toLowerCase();
      if (STOP.has(w)) continue;
      out.push({ w, start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  /** Shingles (k consecutive content words). list[j] covers tokens j..j+k-1. */
  function analyse(text) {
    const toks = tokens(text);
    const list = [];
    if (toks.length && toks.length < SHINGLE) list.push(toks.map((t) => t.w).join(" "));
    for (let j = 0; j + SHINGLE <= toks.length; j++) list.push(toks.slice(j, j + SHINGLE).map((t) => t.w).join(" "));
    return { toks, list, set: new Set(list), words: (String(text).match(/[\p{L}\p{N}]+/gu) || []).length };
  }

  /** MinHash signature: Uint32Array(32). An empty text gives all 0xffffffff. */
  function minhash(text) {
    const { set, toks, words } = analyse(text);
    const sig = new Array(NUM_HASHES).fill(TWO32 - 1n);
    for (const sh of set) {
      const x = BigInt(fnv1a32(sh));
      for (let i = 0; i < NUM_HASHES; i++) {
        let v = (COEFF[i][0] * x + COEFF[i][1]) % P;
        if (v >= TWO32) v -= TWO32; // 15 values in [2^32, P): wrap (negligible bias)
        if (v < sig[i]) sig[i] = v;
      }
    }
    return { sig: Uint32Array.from(sig.map(Number)), shingles: set.size, contentWords: toks.length, words };
  }

  function fingerprintHex(sig) {
    return "0x" + Array.from(sig, (v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }
  function parseFingerprint(hex) {
    const h = String(hex || "").replace(/^0x/, "");
    if (h.length !== FINGERPRINT_BYTES * 2) return null;
    const out = new Uint32Array(NUM_HASHES);
    for (let i = 0; i < NUM_HASHES; i++) out[i] = parseInt(h.slice(i * 8, i * 8 + 8), 16) >>> 0;
    return out;
  }
  /** Fraction of equal signature slots, plus which slots matched. */
  function similarity(a, b) {
    const A = typeof a === "string" ? parseFingerprint(a) : a;
    const B = typeof b === "string" ? parseFingerprint(b) : b;
    if (!A || !B) return { score: 0, matches: [] };
    const matches = Array.from(A, (v, i) => v === B[i] && v !== 0xffffffff);
    return { score: matches.filter(Boolean).length / NUM_HASHES, matches };
  }

  /** Exact Jaccard similarity of the two shingle sets (needs both texts). */
  function jaccard(textA, textB) {
    const A = analyse(textA).set;
    const B = analyse(textB).set;
    let inter = 0;
    for (const s of A) if (B.has(s)) inter++;
    const union = A.size + B.size - inter;
    return { score: union ? inter / union : 0, shared: inter, a: A.size, b: B.size };
  }

  // ---------- overlap view ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function markSide(text, info, shared) {
    const marked = new Array(info.toks.length).fill(false);
    const runs = [];
    let run = null;
    info.list.forEach((sh, j) => {
      if (info.toks.length < SHINGLE) return;
      if (shared.has(sh)) {
        for (let k = j; k < j + SHINGLE; k++) marked[k] = true;
        if (run && run.last === j - 1) run.last = j;
        else runs.push((run = { first: j, last: j }));
      }
    });
    // merge consecutive marked tokens into character ranges
    const ranges = [];
    for (let i = 0; i < marked.length; i++) {
      if (!marked[i]) continue;
      let k = i;
      while (k + 1 < marked.length && marked[k + 1]) k++;
      ranges.push([info.toks[i].start, info.toks[k].end]);
      i = k;
    }
    let html = "";
    let pos = 0;
    for (const [s, e] of ranges) {
      html += esc(text.slice(pos, s)) + "<mark>" + esc(text.slice(s, e)) + "</mark>";
      pos = e;
    }
    html += esc(text.slice(pos));
    const passages = runs.map((r) => {
      const s = info.toks[r.first].start;
      const e = info.toks[r.last + SHINGLE - 1].end;
      const t = text.slice(s, e).replace(/\s+/g, " ");
      return { text: t, words: (t.match(/[\p{L}\p{N}]+/gu) || []).length };
    });
    const markedWords = marked.filter(Boolean).length;
    return { html, passages, coverage: info.toks.length ? markedWords / info.toks.length : 0 };
  }

  /** Side-by-side overlap: both texts as HTML with shared passages in <mark>, plus the passages. */
  function overlap(textA, textB) {
    const a = analyse(textA);
    const b = analyse(textB);
    const shared = new Set([...a.set].filter((s) => b.set.has(s)));
    const A = markSide(textA, a, shared);
    const B = markSide(textB, b, shared);
    const union = a.set.size + b.set.size - shared.size;
    return {
      htmlA: A.html,
      htmlB: B.html,
      passages: A.passages.sort((x, y) => y.words - x.words),
      coverageA: A.coverage,
      coverageB: B.coverage,
      shared: shared.size,
      jaccard: union ? shared.size / union : 0,
    };
  }

  // ---------- hashing ----------
  function subtle() {
    if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto.subtle;
    return require("crypto").webcrypto.subtle; // older Node
  }
  const toHex = (bytes) => "0x" + Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  async function sha256Hex(data) {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    return toHex(new Uint8Array(await subtle().digest("SHA-256", bytes)));
  }
  /** The report hash recorded on-chain: SHA-256 of the normalised report text (UTF-8, LF). */
  const reportHash = (text) => sha256Hex(normalizeReport(text));

  function randomSalt() {
    const c = (typeof globalThis !== "undefined" && globalThis.crypto) || require("crypto").webcrypto;
    return toHex(c.getRandomValues(new Uint8Array(16)));
  }
  /** Demo salts are derived from a fixed label so the seeded records are reproducible. */
  const demoSalt = async (label) => (await sha256Hex("projectledger-demo-salt|" + label)).slice(0, 34);

  const normRoll = (r) => String(r || "").trim().toUpperCase().replace(/\s+/g, "");
  /** teamHash = SHA-256( salt ‖ "|" ‖ roll numbers sorted and joined by "," ). */
  function teamMessage(salt, rolls) {
    const list = rolls.map(normRoll).filter(Boolean).sort();
    return `${String(salt).toLowerCase()}|${list.join(",")}`;
  }
  const teamHash = (salt, rolls) => sha256Hex(teamMessage(salt, rolls));

  const initials = (name) =>
    String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + ".")
      .join("");
  const teamDisplay = (members) => members.map((m) => initials(m.name)).join(", ");

  /** "Name, ROLL" per line -> [{name, roll}] */
  function parseMembers(text) {
    return String(text || "")
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.lastIndexOf(",");
        return i < 0 ? { name: l, roll: "" } : { name: l.slice(0, i).trim(), roll: normRoll(l.slice(i + 1)) };
      });
  }

  /** Everything needed for registerProject(info, reportHash, fingerprint, teamHash, similarToId). */
  async function buildRegistration({ title, domain, year, guide, text, members, salt, similarToId = 0 }) {
    const report = normalizeReport(text);
    const mh = minhash(report);
    const rHash = await reportHash(report);
    const tHash = await teamHash(salt, members.map((m) => m.roll));
    const display = teamDisplay(members);
    const fp = fingerprintHex(mh.sig);
    return {
      args: [[title, domain, Number(year), display, guide], rHash, fp, tHash, Number(similarToId)],
      reportHash: rHash,
      fingerprint: fp,
      teamHash: tHash,
      teamDisplay: display,
      minhash: mh,
    };
  }

  const api = {
    NUM_HASHES,
    SHINGLE,
    NEAR_DUP,
    RELATED,
    FINGERPRINT_BYTES,
    MAX_TEXT,
    normalizeReport,
    tokens,
    analyse,
    fnv1a32,
    minhash,
    fingerprintHex,
    parseFingerprint,
    similarity,
    jaccard,
    overlap,
    sha256Hex,
    reportHash,
    randomSalt,
    demoSalt,
    teamMessage,
    teamHash,
    initials,
    teamDisplay,
    parseMembers,
    buildRegistration,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ProjectLedgerCrypto = api;
})(typeof window !== "undefined" ? window : globalThis);
