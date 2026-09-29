// Scannen (stap 5): van gelezen tekst (OCR) naar de juiste kaart. Geen scherm-code, zodat dit los te testen is.

// Naam vergelijkbaar maken: zonder accenten, kleine letters, alleen letters/cijfers met één spatie ertussen
export function normName(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Kaartnummer vergelijkbaar maken: hoofdletters, voorloopnullen weg ("071" → "71", "TG05" → "TG5")
export function numKey(s) {
  const m = String(s || "").toUpperCase().replace(/\s+/g, "").match(/^([A-Z]*)0*(\d+)([A-Z]*)$/);
  return m ? m[1] + m[2] + m[3] : String(s || "").toUpperCase();
}

// Letters die OCR vaak met cijfers verwart
const LOOKALIKE = { O: "0", D: "0", Q: "0", I: "1", L: "1", T: "1", Z: "2", S: "5", B: "8", G: "6" };
const asDigits = (s) => s.replace(/[ODQILTZSBG]/g, (ch) => LOOKALIKE[ch]);

// Zoekt nummers als "071/191" of "TG05/TG30" in de tekst; geeft [{ num, tot }], met varianten voor verwarde letters
export function parseNumbers(text) {
  const out = [], seen = new Set();
  const add = (num, tot) => {
    const key = numKey(num) + "/" + numKey(tot);
    if (!/\d/.test(num) || seen.has(key)) return;
    seen.add(key);
    out.push({ num: numKey(num), tot: numKey(tot) });
  };
  const upper = String(text || "").toUpperCase();
  for (const m of upper.matchAll(/([A-Z0-9]{1,6})\s*[/|\\]\s*([A-Z0-9]{1,6})/g)) {
    const [, a, b] = m;
    add(a, b);                                  // zoals gelezen, bv. TG05/TG30
    add(asDigits(a), asDigits(b));              // alles als cijfer, bv. O71/l91 → 071/191
    const pre = a.match(/^([A-Z]{1,4})(.+)$/);  // letters vooraan houden, rest als cijfer (bv. TGO5 → TG05)
    if (pre) add(pre[1] + asDigits(pre[2]), b.replace(/^([A-Z]{1,4})?(.*)$/, (x, p, r) => (p || "") + asDigits(r)));
    const tail = a.match(/(\d+)$/);             // rommel ervoor weg, alleen de cijfers aan het eind (bv. ER005 → 005)
    if (tail) add(tail[1], asDigits(b.replace(/^[A-Z]+(?=\d)/, "")));
  }
  // Soms leest OCR de schuine streep als een 1 of 7 ("006/165" → "0067165"); dan de eerste drie cijfers proberen
  for (const m of upper.matchAll(/(?<![0-9])(\d{3})[17](\d{3})(?![0-9])/g)) add(m[1], m[2]);
  return out;
}

// Stukjes van drie letters (met spatie ervoor en erachter, zodat "Mew" en "Mewtwo" verschillen)
export function trigrams(s) {
  const t = ` ${normName(s)} `, out = new Set();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

// Welk deel van de naam in de tekst terugkomt (0 = niets, 1 = alles)
function nameScore(nameGrams, textGrams) {
  if (!nameGrams.size) return 0;
  let hit = 0;
  for (const g of nameGrams) if (textGrams.has(g)) hit++;
  return hit / nameGrams.size;
}

// Achtervoegsels die als gestileerd logo op de kaart staan en die OCR slecht leest ("Charizard ex", "Lapras GX")
const SUFFIX = /\s(ex|gx|v|vmax|vstar|v union|break|lv x|prime|legend|star|tag team)$/;
// Oude kaarten noemen boven de naam de vorige evolutie ("Evolves from Charmeleon"); die naam telt niet mee
const EVOLVES = /\bfrom\s+\S+/gi;

// Weging: een goed nummer telt zwaar, de naam iets zwaarder; het juiste totaal (bv. /191) helpt de set kiezen
const W_NUM = 2, W_TOT = 1, W_NAME = 2.5, W_SUFFIX = 0.3;
// Vanaf deze score en met deze voorsprong op de nummer twee noemen we het een herkende kaart; anders "niet zeker"
const SURE = 2.5, LEAD = 0.5;

// Zet de kaarten op volgorde van hoe goed ze bij de gelezen tekst passen.
// pool: [{ id, name, number, total }] (total = gedrukt totaal van de set), bij twijfel wint wie eerder in de pool staat;
// read: { name, number } (gelezen tekst bovenaan en onderaan de kaart). Geeft { list, sure }.
export function rankCards(pool, read) {
  const nums = parseNumbers(read.number).concat(parseNumbers(read.name));
  const nameText = String(read.name || "").replace(EVOLVES, " ");
  const textGrams = trigrams(nameText), textNorm = ` ${normName(nameText)} `;
  const byNum = new Map();
  for (const n of nums) (byNum.get(n.num) || byNum.set(n.num, []).get(n.num)).push(n.tot);
  const scored = [];
  for (const c of pool) {
    if (!c.grams) {
      const norm = normName(c.name), suffix = norm.match(SUFFIX);
      c.grams = trigrams(suffix ? norm.slice(0, suffix.index) : norm);
      c.suffix = suffix ? ` ${suffix[1]} ` : null;
    }
    const tots = byNum.get(numKey(c.number));
    const numHit = tots ? 1 : 0;
    const totHit = tots && c.total && tots.some((t) => t.replace(/\D/g, "") === String(c.total)) ? 1 : 0;
    const nameS = nameScore(c.grams, textGrams);
    // Een naam die maar half klopt, telt niet (anders scoort elke kaart met een "e" of "a" een beetje)
    const nameW = nameS >= 0.5 ? nameS : 0;
    const suffixHit = nameW && c.suffix && textNorm.includes(c.suffix) ? 1 : 0;
    const score = W_NUM * numHit + W_TOT * totHit + W_NAME * nameW + W_SUFFIX * suffixHit;
    // Bij gelijke score wint de langste naam die past (anders wint "Mew" van "Mewtwo")
    if (score > 0) scored.push({ card: c, score, tie: nameW * c.grams.size });
  }
  const list = scored.sort((a, b) => b.score - a.score || b.tie - a.tie);
  const sure = !!list[0] && list[0].score >= SURE && (!list[1] || list[0].score - list[1].score >= LEAD);
  return { list, sure };
}

// Zelf zoeken op naam of nummer (als de scan het niet goed had); maximaal max resultaten
export function searchCards(pool, query, max = 8) {
  const q = normName(query);
  if (!q) return [];
  const qNum = numKey(query.trim().split("/")[0]);
  const out = [];
  for (const c of pool) {
    if (normName(c.name).includes(q) || numKey(c.number) === qNum) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
