// Stashdex: de app na het inloggen (indeling, collectie, Start en Statistiek, Instellingen, scannen)
import { supabase, safe } from "./supabase-client.js";
import { startAuth, openPasswordChange } from "./auth.js";
import { tier, rarityRank, holoLevel, typeName, typeKey, TYPES, TIER_NAMES } from "./rarity.js";
import { rankCards, searchCards } from "./scan-match.js";
import { prepareOcr, ocrReady, startCamera, stopCamera, grabFrame, fileToCanvas, thumbOf, readCard, readWhole } from "./scan-camera.js";

// Prijzen in de data zijn in euro's (Cardmarket); dollars worden omgerekend met de ECB-koers uit data/meta.json.
// Reservekoers (22-09-2026) alleen voor als meta.json niet laadt.
const FALLBACK_EUR_USD = 1 / 0.87;
const PAGE = 20; // aantal kaarten per "Toon meer"
// Letters voor de kaartnummers van een subset (als die alleen cijfers zijn)
const PART_CODES = { "Classic Collection": "CC" };
// Periodes voor de prijsgrafiek: label en aantal dagen
// Id van de map "Alle kaarten" (je hele collectie over alle sets); geen echte set
const ALL = "__alle";
const PERIODS = [["7D", 7], ["1M", 30], ["3M", 91], ["6M", 182], ["1J", 365], ["Alles", Infinity]];

// ---------- Kleine hulpjes ----------

// Maakt een HTML-element; tekst wordt altijd als tekst gezet, nooit als code
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

// Vaste lijn-icoontjes (alleen eigen, vaste tekst — geen invoer van buiten)
function icon(paths, size = 22) {
  const t = document.createElement("template");
  t.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  return t.content.firstChild;
}
const ICONS = {
  scan: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  collection: '<rect x="7" y="4" width="11" height="15" rx="2"/><path d="M4.5 7.5v11A2.5 2.5 0 0 0 7 21h8.5"/>',
  wish: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  binders: '<rect x="6" y="3.5" width="13" height="17" rx="2"/><path d="M9.5 3.5v17M4 7.5h3.5M4 12h3.5M4 16.5h3.5"/>',
  stats: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  collapse: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
  expand: '<path d="m13 17 5-5-5-5M6 17l5-5-5-5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};

// Het Stashdex-logo: schuine kaart met holo-binnenkant, gele S en sterretje.
// Elke kopie krijgt een eigen id voor het verloop, anders pakt elke kopie dat van de eerste.
let logoCount = 0;
function logo(size, cls = "") {
  const id = "sdx-holo-" + ++logoCount;
  const t = document.createElement("template");
  t.innerHTML = `<svg class="sdx-logo ${cls}" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d365"/><stop offset=".4" stop-color="#f98ca8"/><stop offset=".75" stop-color="#8fc8ff"/><stop offset="1" stop-color="#f6d365"/></linearGradient></defs>`
    + `<g transform="rotate(-9 60 60)"><rect x="26" y="12" width="68" height="96" rx="12" fill="#0b2447" stroke="#ffcb05" stroke-width="5"/><rect x="35" y="21" width="50" height="78" rx="7" fill="url(#${id})"/>`
    + `<path transform="translate(41.03 80) scale(0.058 -0.058)" d="M25 69Q25 125 41.0 185.5Q57 246 79 246Q83 246 162.0 219.0Q241 192 281.0 192.0Q321 192 333.0 200.5Q345 209 345.0 225.0Q345 241 323.0 253.5Q301 266 268.0 275.5Q235 285 196.5 303.0Q158 321 125.0 343.0Q92 365 70.0 405.5Q48 446 48 498Q48 720 313 720Q412 720 484.0 707.5Q556 695 585.5 679.5Q615 664 615 649Q615 597 590.5 537.0Q566 477 543 477Q539 477 517 486Q451 515 407.5 515.0Q364 515 348.5 507.0Q333 499 333.0 482.5Q333 466 355.0 455.5Q377 445 409.5 436.5Q442 428 480.5 410.5Q519 393 552.0 369.5Q585 346 607.0 303.0Q629 260 629 203Q629 143 598 94Q579 64 549.0 42.0Q519 20 465.5 5.5Q412 -9 327.5 -9.0Q243 -9 167.0 5.0Q91 19 58.0 36.0Q25 53 25 69Z" fill="#ffcb05" stroke="#0b2447" stroke-width="120.7" stroke-linejoin="round" paint-order="stroke"/></g>`
    + `<path d="M96 12l3.2 8.3 8.3 3.2-8.3 3.2-3.2 8.3-3.2-8.3-8.3-3.2 8.3-3.2z" fill="#ffcb05" stroke="#0b2447" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
  return t.content.firstChild;
}

// Voorkeuren per apparaat (gekozen set, weergave, valuta …)
const pref = {
  get(key, fallback) {
    const v = safe(() => localStorage.getItem("stashdex-" + key));
    if (v == null) return fallback;
    try { return JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { safe(() => localStorage.setItem("stashdex-" + key, JSON.stringify(value))); },
};

// ---------- Toestand van de app ----------
const S = {
  userId: null,
  sets: [], setById: {}, series: [], setsError: null,
  parentOf: {}, subsets: {},          // subsets (bv. Classic Collection) per hoofdset
  cards: {}, cardsError: {},          // per set-id: de kaarten uit data/cards/<id>.json
  history: {},                        // per set-id: belofte met de prijsgeschiedenis uit data/history/<id>.json
  cardById: {},                       // alle geladen kaarten op kaart-id (voor de kaartwaaier)
  owned: {}, ownedLoaded: false, ownedError: null, // per sleutel "<kaart-id>|<versie>": { count }
  wishCount: null,                    // aantal kaarten op je wensenlijst (voor de tegel op Start)
  rate: { eurUsd: FALLBACK_EUR_USD, date: null },  // 1 euro = eurUsd dollar; date = dag van de ECB-koers
  meta: {},                           // data/meta.json: datum van de prijzen en de koers
  email: "",
  nav: "collection",
  // Instellingen die mee gaan naar elk apparaat (zie SYNCED); lokaal bewaard als snelle start
  setId: pref.get("set", "30th"),
  view: pref.get("view", "cards"),
  sort: pref.get("sort", "number"),
  sortRev: pref.get("sortRev", false),   // true = omgekeerde volgorde (alleen bij Nummer, Alfabet en Waarde)
  cur: pref.get("cur", "EUR"),
  period: pref.get("period", "1M"),
  // Uitgelichte kaarten (waaier, topkaart, top 4): op zeldzaamheid (dan waarde) of op waarde (dan zeldzaamheid)
  featBy: pref.get("featBy", pref.get("topBy", "rarity") === "value" ? "value" : "rarity"),
  showMissing: pref.get("showMissing", true),
  motion: pref.get("motion", "on"),      // holo en kantelen: on · calm · off
  theme: pref.get("theme", "auto"),      // light · dark · auto
  settingsLoaded: false,
  // Per apparaat (niet naar Supabase): setpaneel open/dicht en welke series opengeklapt zijn
  open: pref.get("open", {}),
  q: "", filterOpen: false, own: "all", typeF: "all", shown: PAGE,
};

// ---------- Instellingen: lokaal (pref, snel) en in Supabase (mee naar elk apparaat) ----------
// [sleutel in Supabase/pref, veld in S]; Supabase is de baas: bij het inloggen overschrijft die de lokale waarden
const SYNCED = [["featBy", "featBy"], ["cur", "cur"], ["view", "view"], ["sort", "sort"], ["sortRev", "sortRev"], ["showMissing", "showMissing"],
  ["motion", "motion"], ["theme", "theme"], ["set", "setId"], ["period", "period"]];
const fieldOf = Object.fromEntries(SYNCED);

// Eén instelling wijzigen: meteen lokaal, en na 800 ms rust ook in Supabase
function setSetting(key, value) {
  S[fieldOf[key]] = value;
  pref.set(key, value);
  if (key === "theme" || key === "motion") applyLook();
  scheduleSync();
}

let syncTimer = null;
function scheduleSync() {
  if (!S.settingsLoaded) return; // eerst de instellingen uit Supabase hebben, anders overschrijven we ze
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (!S.userId) return;
    const settings = Object.fromEntries(SYNCED.map(([key, field]) => [key, S[field]]));
    const { error } = await supabase.from("user_settings")
      .upsert({ user_id: S.userId, settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) console.warn("Instellingen niet opgeslagen in Supabase:", error.message);
  }, 800);
}

// Instellingen van dit account ophalen; lukt dat niet, dan gelden de lokale waarden
async function loadSettings() {
  try {
    const { data, error } = await supabase.from("user_settings").select("settings").maybeSingle();
    if (error) throw error;
    for (const [key, field] of SYNCED) {
      if (data?.settings && key in data.settings) {
        S[field] = data.settings[key];
        pref.set(key, data.settings[key]);
      }
    }
    applyLook();
  } catch (err) {
    console.warn("Instellingen niet geladen uit Supabase:", err.message);
  }
  S.settingsLoaded = true;
}

// Thema (licht/donker) en beweging op <html>; "minder beweging" op het apparaat zet de beweging altijd uit
const darkQuery = matchMedia("(prefers-color-scheme: dark)"), calmQuery = matchMedia("(prefers-reduced-motion: reduce)");
function applyLook() {
  const root = document.documentElement;
  root.dataset.theme = S.theme === "auto" ? (darkQuery.matches ? "dark" : "light") : S.theme;
  root.dataset.motion = calmQuery.matches ? "off" : S.motion;
}
darkQuery.addEventListener("change", applyLook);
calmQuery.addEventListener("change", applyLook);

// Kaart-id = "<set-id>-<nummer>"; set-id's kunnen zelf een streepje bevatten (bv. 30th-c), nummers niet
const setIdOf = (cardId) => cardId.slice(0, cardId.lastIndexOf("-"));
const parentIdOf = (setId) => S.parentOf[setId] || setId;
// Een kaart kan in twee versies in je collectie staan: normaal en reverse holo (punt 21).
// Sleutel in S.owned = "<kaart-id>|<versie>"; altijd via ownedKey() maken, nooit zelf plakken
const VARIANT_LABEL = { normal: "Normaal", reverse: "Reverse holo" };
const ownedKey = (cardId, variant = "normal") => `${cardId}|${variant}`;
const splitKey = (key) => { const i = key.lastIndexOf("|"); return [key.slice(0, i), key.slice(i + 1)]; };
const variantOf = (card) => card.variant || "normal";
const countOf = (card) => S.owned[ownedKey(card.id, variantOf(card))]?.count || 0;
// De reverse holo van een kaart als eigen kaart: zelfde gegevens, eigen prijs; komt direct na de gewone versie
const revCache = new WeakMap();
function revOf(card) {
  let r = revCache.get(card);
  if (!r) revCache.set(card, (r = { ...card, variant: "reverse", eur: card.eurRev, i: card.i + 0.5 }));
  return r;
}
// Kaart (in de juiste versie) bij een sleutel uit S.owned; null zolang de set nog niet geladen is
function entryOf(key) {
  const [id, variant] = splitKey(key), card = S.cardById[id];
  return card ? (variant === "reverse" ? revOf(card) : card) : null;
}
// Kaarten van een set, met direct na elke kaart de reverse holo als je die hebt (een ontbrekende reverse krijgt geen tegel)
const withReverses = (cards) => cards.flatMap((c) => (S.owned[ownedKey(c.id, "reverse")] ? [c, revOf(c)] : [c]));
// Waarde van een kaart = de Cardmarket-marktprijs (euro's) uit de nachtelijke data; eigen waardes bestaan niet (besluit 28-09)
function valueEur(card) {
  return card.eur ?? null;
}
// Totaal van een hoofdset inclusief zijn subsets
const setTotal = (set) => S.cards[set.id]?.length || (S.subsets[set.id] || []).reduce((n, s) => n + (s.total || 0), set.total || 0);
// Kaartnummer; Classic Collection krijgt "CC" ervoor, zodat #004 en #CC004 niet door elkaar lopen
const numTxt = (card) => {
  const n = /^\d+$/.test(card.number) ? card.number.padStart(3, "0") : card.number;
  return "#" + (card.partCode && /^\d/.test(n) ? card.partCode : "") + n;
};

function money(eur) {
  if (eur == null) return null;
  const n = S.cur === "EUR" ? eur : eur * S.rate.eurUsd;
  const big = n >= 1000;
  const digits = big ? 0 : 2;
  return (S.cur === "EUR" ? "€" : "$") + " " + n.toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Aantal verschillende kaartnummers in bezit, per set; normaal en reverse holo van één kaart tellen samen als één
function ownedBySet() {
  const out = {};
  for (const id of new Set(Object.keys(S.owned).map((key) => splitKey(key)[0]))) {
    const set = parentIdOf(setIdOf(id));
    out[set] = (out[set] || 0) + 1;
  }
  return out;
}

// ---------- Gegevens laden ----------

async function loadSets() {
  if (S.sets.length) return;
  try {
    const res = await fetch("data/sets.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Nieuwste sets eerst; series in de volgorde van hun nieuwste set
    const sets = (await res.json()).sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || ""));

    // Subsets (bv. Classic Collection) horen bij hun hoofdset; die koppeling staat al in de data
    const ids = new Set(sets.map((s) => s.id));
    S.parentOf = {};
    S.subsets = {};
    for (const s of sets) {
      if (!s.parent || !ids.has(s.parent)) continue;
      S.parentOf[s.id] = s.parent;
      (S.subsets[s.parent] ||= []).push(s);
    }

    const bySeries = new Map();
    for (const s of sets.filter((x) => !S.parentOf[x.id])) {
      if (!bySeries.has(s.series)) bySeries.set(s.series, []);
      bySeries.get(s.series).push(s);
    }
    S.sets = sets;
    S.setById = Object.fromEntries(sets.map((s) => [s.id, s]));
    S.series = [...bySeries].map(([name, list]) => ({ name, sets: list }));
    if (S.setId !== ALL) S.setId = parentIdOf(S.setId);
    if (S.setId !== ALL && !S.setById[S.setId]) S.setId = S.series[0]?.sets[0]?.id;
  } catch (err) {
    S.setsError = `De lijst met sets kon niet geladen worden (${err.message}).`;
  }
}

// Dollarkoers van de ECB ophalen; lukt dat niet, dan blijft de reservekoers staan
async function loadRate() {
  try {
    const res = await fetch("data/meta.json", { cache: "no-cache" });
    if (!res.ok) return;
    const meta = await res.json();
    S.meta = meta;
    if (meta.eurUsd > 0) S.rate = { eurUsd: meta.eurUsd, date: meta.rateDate || null };
  } catch { /* reservekoers blijft staan */ }
}

// Kaarten van een set ophalen; een set die al onderweg is wordt niet dubbel opgehaald
const loading = {};
function loadCards(setId) {
  if (setId === ALL) return loadOwnedSets();
  if (!setId || S.cards[setId]) return Promise.resolve();
  return (loading[setId] ||= fetchCards(setId).finally(() => {
    delete loading[setId];
    render();
  }));
}

// Sets (hoofdsets) waar je kaarten van hebt
const ownedSetIds = () => [...new Set(Object.keys(S.owned).map((key) => parentIdOf(setIdOf(splitKey(key)[0]))))].filter((id) => S.setById[id]);

// Kaarten van al je sets ophalen (voor de kaartwaaier en de map "Alle kaarten")
function loadOwnedSets() {
  return Promise.all(ownedSetIds().map((id) => loadCards(id)));
}

// Je hele collectie over alle sets, nieuwste set eerst; null zolang er nog sets laden
function collectionCards() {
  const ids = new Set(ownedSetIds());
  if ([...ids].some((id) => !S.cards[id] && !S.cardsError[id])) return null;
  const out = [];
  for (const s of S.sets) {
    if (!ids.has(s.id)) continue;
    for (const c of withReverses(S.cards[s.id] || [])) {
      if (countOf(c)) out.push({ ...c, i: out.length, group: c.part ? `${s.name} · ${c.part}` : s.name });
    }
  }
  return out;
}

async function fetchCards(setId) {
  delete S.cardsError[setId];
  try {
    // Hoofdset en zijn subsets samen ophalen; de subsets komen achteraan
    const parts = [S.setById[setId], ...(S.subsets[setId] || [])].filter(Boolean);
    const lists = await Promise.all(parts.map(async (p) => {
      const res = await fetch(`data/cards/${encodeURIComponent(p.id)}.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).map((c) => ({ ...c, setId: p.id, part: p.part || null, partCode: PART_CODES[p.part] || null }));
    }));
    // i = plek in de set, voor sorteren op nummer
    S.cards[setId] = lists.flat().map((c, i) => ({ ...c, i }));
    for (const c of S.cards[setId]) S.cardById[c.id] = c;
  } catch (err) {
    S.cardsError[setId] = `De kaarten van deze set konden niet geladen worden (${err.message}).`;
  }
}

// Aantal kaarten op je wensenlijst; lukt dat niet, dan blijft de tegel op Start op "…" staan
async function loadWishCount() {
  const { count, error } = await supabase.from("wishlist").select("card_id", { count: "exact", head: true });
  if (!error) S.wishCount = count ?? 0;
}

// Hele collectie ophalen, in stukken van 1000 (de maximale grootte per keer)
async function loadOwned() {
  try {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("collection")
        .select("card_id,variant,count").order("card_id").order("variant").range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    S.owned = Object.fromEntries(rows.map((r) => [ownedKey(r.card_id, r.variant), { count: r.count }]));
    S.ownedLoaded = true;
    S.ownedError = null;
  } catch (err) {
    S.ownedError = `Je collectie kon niet geladen worden (${err.message}). Ververs de pagina om het opnieuw te proberen.`;
  }
}

// ---------- Onderdelen uit het ontwerpsysteem ----------

function chip(rarity) {
  if (!rarity) return null;
  const t = tier(rarity);
  return el("span", { class: `kk-chip kk-chip-tier-${t ? t.tone : "c"}`, title: rarity },
    el("span", {}, t ? `${t.sym} ${t.code}` : rarity));
}

function pageTitle(title, subtitle) {
  return el("h2", { class: "kk-page-title" }, title, subtitle ? el("small", {}, subtitle) : null);
}

function setProgress(name, owned, total) {
  owned = Math.min(owned, total);
  const pct = total ? Math.round((owned / total) * 100) : 0;
  return el("div", { class: "kk-progress" + (total && owned === total ? " kk-progress-done" : ""), role: "group", "aria-label": `${name}: ${owned} van ${total} verzameld` },
    el("div", { class: "kk-progress-name" }, name, el("small", {}, `${pct}% verzameld`)),
    el("div", { class: "kk-progress-count" }, el("b", {}, owned), ` / ${total}`),
    el("div", { class: "kk-progress-track", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": owned },
      el("div", { class: "kk-progress-fill", style: `width:${pct}%` })));
}

// Samenvatting bovenaan "Alle kaarten": aantal kaarten en sets, exemplaren en totale waarde
function collectionSummary(cards) {
  const list = cards || [];
  const copies = list.reduce((n, c) => n + countOf(c), 0);
  const worth = list.reduce((sum, c) => sum + (valueEur(c) ?? 0) * countOf(c), 0);
  const sets = new Set(list.map((c) => parentIdOf(c.setId))).size;
  return el("div", { class: "kk-progress coll-sum", role: "group", "aria-label": "Je collectie in het kort" },
    el("div", { class: "kk-progress-name" }, "Mijn collectie",
      el("small", {}, cards ? `${list.length} kaarten · ${copies} exemplaren · ${sets} ${sets === 1 ? "set" : "sets"}` : "laden…")),
    el("div", { class: "kk-progress-count coll-worth" }, el("small", {}, "Waarde"), el("b", {}, cards ? money(worth) : "—")));
}

function emptyState(title, text) {
  return el("div", { class: "kk-empty" },
    el("div", { class: "kk-empty-slots", "aria-hidden": "true" }, el("i"), el("i"), el("i")),
    el("b", {}, title), text);
}

function tabs(value, items, onChange) {
  return el("div", { class: "kk-tabs", role: "tablist" },
    items.map((o) => el("button", { type: "button", role: "tab", class: "kk-tab", "aria-selected": String(o.value === value), onclick: () => onChange(o.value) }, o.label)));
}

function segmented(label, value, options, onChange) {
  return el("div", { class: "kk-seg", role: "group", "aria-label": label },
    options.map((o) => el("button", { type: "button", "aria-pressed": String(o.value === value), onclick: () => onChange(o.value) }, o.label)));
}

let selectId = 0;
function select(label, value, options, onChange) {
  const id = "sel-" + ++selectId;
  const box = el("select", { id, onchange: (e) => onChange(e.target.value) },
    options.map((o) => el("option", { value: o.value }, o.label)));
  box.value = value;
  return el("div", { class: "kk-select" }, el("label", { for: id }, label), box);
}

function fact(label, value, cls) {
  const empty = value == null || value === "";
  return el("div", { class: "kk-fact" + (cls ? " " + cls : "") }, el("i", {}, label), el("b", { class: empty ? "kk-none" : null }, empty ? "—" : value));
}

// Kopje boven een subset (bv. "Classic Collection") in het kaartoverzicht
const partTitle = (part) => el("h3", { class: "part-title" }, part);

// Zet een kopje vóór de eerste kaart van elke subset (of elke set bij "Alle kaarten");
// alleen bij sorteren op nummer, anders lopen ze door elkaar
function withHeadings(cards, heading, node) {
  const out = [];
  let prev = null;
  for (const c of cards) {
    const key = c.group ?? c.part;
    if (S.sort === "number" && key && key !== prev) out.push(heading(key));
    prev = key;
    out.push(node(c));
  }
  return out;
}

// Plaatje van een kaart; sommige oude kaarten hebben er (nog) geen, die krijgen een nette lege kaart
function cardImg(card, { large = false, lazy = true } = {}) {
  const src = (large && card.imgLarge) || card.img;
  const empty = () => el("span", { class: "no-art", role: "img", "aria-label": `${card.name} (geen afbeelding)` }, el("span", {}, card.name));
  if (!src) return empty();
  // De plaatjesserver hapert soms; dan tot 3 keer opnieuw proberen (steeds iets later), daarna de lege kaart
  let tries = 0;
  const img = el("img", { src, alt: large ? card.name : "", loading: lazy ? "lazy" : null });
  img.addEventListener("error", () => {
    if (++tries > 3) return img.isConnected && img.replaceWith(empty());
    setTimeout(() => { img.src = `${src}${src.includes("?") ? "&" : "?"}opnieuw=${tries}`; }, 800 * tries);
  });
  return img;
}

// Kaarttegel: plaatje, type, naam, zeldzaamheid en Nr · Aantal · Waarde
// foil = glans altijd aan (topkaart), anders alleen vanaf Illustration Rare; holoMin = minimale glans (topkaart)
function cardTile(card, { foil = false, holoMin = 0 } = {}) {
  const n = countOf(card), t = tier(card.rarity), missing = !n, rev = variantOf(card) === "reverse";
  const cls = ["kk-card", "kk-type-" + typeKey(card), t?.band && "kk-holo-" + t.band, !missing && (foil || (t && t.rank >= 5)) && "kk-card-foil", missing && "kk-card-missing", rev && "kk-card-rev"].filter(Boolean).join(" ");
  return el("button", { type: "button", class: cls, style: `--kk-holo-max:${Math.max(holoLevel(card.rarity), holoMin)}`, "aria-label": card.name + (rev ? " (reverse holo)" : "") + (missing ? " (nog niet in bezit, klik om toe te voegen)" : ""), onclick: () => openModal(card) },
    el("div", { class: "kk-card-art" }, cardImg(card), rev ? rhSheen() : null),
    el("span", { class: "kk-type-tag" }, typeName(card)),
    rev ? rhTag() : null,
    missing ? el("span", { class: "kk-missing-tag" }, "Nog niet") : null,
    el("div", { class: "kk-card-info" },
      el("div", { class: "kk-card-name", title: card.name }, card.name),
      el("div", { class: "kk-card-rar" }, chip(card.rarity)),
      el("div", { class: "kk-card-facts" },
        fact("Nr", numTxt(card)), fact("Aantal", n ? n + "×" : null), fact("Waarde", n ? money(valueEur(card)) : null, "kk-fact-value"))));
}

// Label "RH" op een reverse holo (pilletje in de stijl van het type-label)
const rhTag = () => el("span", { class: "rh-tag", title: "Reverse holo" }, "RH");
// Lichte holo-structuur over de afbeelding van een reverse holo
const rhSheen = () => el("span", { class: "rh-sheen", "aria-hidden": "true" });

// Kleine liggende kaart voor nummer 2 t/m 4 naast de topkaart: plaatje, naam, zeldzaamheid, waarde
function miniCard(card, place) {
  const rev = variantOf(card) === "reverse";
  return el("button", { type: "button", role: "listitem", class: `mini kk-type-${typeKey(card)}` + (rev ? " mini-rev" : ""), "aria-label": `Nummer ${place}: ${card.name}${rev ? " (reverse holo)" : ""}`, onclick: () => openModal(card) },
    el("span", { class: "mini-place" }, "#" + place),
    el("span", { class: "mini-art" }, cardImg(card)),
    el("span", { class: "mini-info" },
      el("b", { class: "mini-name", title: card.name }, card.name),
      el("span", { class: "mini-chips" }, chip(card.rarity), rev ? rhTag() : null),
      el("span", { class: "mini-val mono" }, money(valueEur(card)) ?? "—")));
}

// ---------- Opbouw van het scherm ----------
const ui = {};

function buildShell() {
  // Slanke holo-header: kaartwaaier · logo + naam · kaartwaaier (valuta staat alleen in Instellingen)
  ui.heroSub = el("span", { class: "slim-sub" });
  ui.fanLeft = el("div", { class: "fan fan-left", "aria-label": "Uitgelicht uit je collectie" });
  ui.fanRight = el("div", { class: "fan fan-right", "aria-label": "Uitgelicht uit je collectie" });
  ui.fanKey = null;
  const hero = el("header", { class: "slimbar kk-hero" },
    ui.fanLeft,
    el("div", { class: "slim-brand" }, logo(40, "slim-logo"), el("h1", { class: "slim-title" }, "Stashdex"), ui.heroSub),
    ui.fanRight);

  // Menubalk: logo, Scan, Start · Collectie · Wensen · Statistiek, Uitloggen
  ui.rail = {};
  const railBtn = (key, label, extra = "") => (ui.rail[key] = el("button", { type: "button", class: `rail-btn ${extra}`.trim(), "data-nav": key, onclick: () => go(key) }, icon(ICONS[key]), el("span", {}, label)));
  const rail = el("nav", { class: "rail", "aria-label": "Hoofdmenu" },
    el("button", { type: "button", class: "mark-btn", "aria-label": "Intro opnieuw afspelen", onclick: () => toast("De intro komt in stap 4") }, logo(52)),
    el("button", { type: "button", class: "scan-btn", "aria-label": "Kaart scannen", onclick: openScan }, icon(ICONS.scan, 24), el("span", {}, "Scan")),
    el("span", { class: "rail-sep" }),
    railBtn("home", "Start"), railBtn("collection", "Collectie"), railBtn("binders", "Binders"), railBtn("wish", "Wensen"), railBtn("stats", "Statistiek"),
    el("span", { class: "rail-spacer" }),
    railBtn("settings", "Instellingen", "rail-btn-long"),
    el("button", { type: "button", class: "rail-btn", "data-nav": "logout", onclick: () => supabase.auth.signOut() }, icon(ICONS.logout), el("span", {}, "Uitloggen")),
    ui.more = el("button", { type: "button", class: "rail-btn rail-more", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: openMore }, icon(ICONS.more), el("span", {}, "Meer")));

  // Setpaneel: zoeken, sets per serie, "+ Editie toevoegen"
  ui.search = el("input", { type: "search", class: "kk-input", placeholder: "Zoek een set of kaart…", "aria-label": "Zoek een set of kaart", autocomplete: "off",
    oninput: (e) => { S.q = e.target.value; S.shown = PAGE; render(); } });
  ui.series = el("nav", { class: "kk-sidebar", "aria-label": "Sets" });
  const panel = el("aside", { class: "setpanel", "aria-label": "Sets" },
    // Ingeklapt: alleen een smalle strook om het paneel weer open te klappen
    el("button", { type: "button", class: "panel-strip", "aria-label": "Setpaneel uitklappen", title: "Setpaneel uitklappen", onclick: () => setPanel(true) },
      icon(ICONS.expand, 20), el("span", {}, "Sets")),
    el("div", { class: "setpanel-search" }, ui.search,
      el("button", { type: "button", class: "icon-btn collapse-btn", "aria-label": "Setpaneel inklappen", title: "Setpaneel inklappen", onclick: () => setPanel(false) }, icon(ICONS.collapse, 20))),
    el("div", { class: "setpanel-list scroll" }, ui.series),
    el("div", { class: "setpanel-foot" },
      el("button", { type: "button", class: "kk-btn kk-btn-ghost kk-btn-block", onclick: () => toast("Editie toevoegen komt in stap 6") }, "+ Editie toevoegen")));

  ui.main = el("main", { class: "main scroll" });
  ui.main.addEventListener("scroll", onMainScroll, { passive: true });
  // Plakbalk: houder zonder hoogte bovenin het hoofdvlak, zodat er niets verspringt als de balk verschijnt
  ui.setbar = el("div", { class: "setbar", role: "button", tabindex: "0", "aria-hidden": "true", title: "Terug naar boven",
    onclick: () => ui.main.scrollTo({ top: 0, behavior: calmQuery.matches ? "auto" : "smooth" }),
    onkeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === ui.setbar) { e.preventDefault(); ui.setbar.click(); } } });
  ui.setbarWrap = el("div", { class: "setbar-wrap" }, ui.setbar);
  ui.panel = panel;
  ui.layout = el("div", { class: "layout" }, rail, panel, ui.main);
  ui.app = $("home");
  ui.app.classList.remove("head-hidden");
  ui.app.replaceChildren(hero, ui.layout);
  setPanel(pref.get("panel", !matchMedia("(max-width: 560px)").matches), false);
}

// Setpaneel in- of uitklappen; de keuze wordt per apparaat onthouden
function setPanel(open, focus = true) {
  ui.panel.classList.toggle("collapsed", !open);
  ui.layout.classList.toggle("panel-collapsed", !open);
  pref.set("panel", open);
  if (focus) ui.panel.querySelector(open ? ".collapse-btn" : ".panel-strip").focus();
}

function render() {
  if (!ui.main || !S.userId) return;
  ui.layout.dataset.nav = S.nav;
  ui.more.classList.toggle("on", ["binders", "stats", "settings"].includes(S.nav));
  const bySet = ownedBySet();
  const setsWith = Object.keys(bySet).length, ownedCards = Object.keys(S.owned).length;
  ui.heroSub.textContent = `${setsWith} ${setsWith === 1 ? "set" : "sets"} · ${ownedCards} kaarten`;
  for (const [key, btn] of Object.entries(ui.rail)) btn.classList.toggle("on", S.nav === key);
  renderFan();
  renderSeries(bySet);
  renderSetbar(bySet);
  ui.main.replaceChildren(ui.setbarWrap, ...renderMain(bySet));
  onMainScroll(); // inhoud veranderd: header en plakbalk opnieuw bepalen
}

// Keuzes voor de werkbalk boven de kaarten (weergave en sorteren staan bewust niet in Instellingen)
const VIEW_OPTIONS = [{ value: "cards", label: "Kaarten" }, { value: "list", label: "Lijst" }, { value: "grid", label: "Raster" }];
const SORT_OPTIONS = [
  { value: "number", label: "Nummer" }, { value: "name", label: "Alfabet" }, { value: "value", label: "Waarde" },
  { value: "rarity", label: "Zeldzaamheid" }, { value: "type", label: "Type" },
];
// Sorteringen die je kunt omdraaien: [standaardrichting, omgekeerd]
const SORT_DIRS = { number: ["1 → 99", "99 → 1"], name: ["A → Z", "Z → A"], value: ["Hoog → laag", "Laag → hoog"] };
const FEAT_OPTIONS = [{ value: "rarity", label: "Zeldzaamheid" }, { value: "value", label: "Waarde" }];

// Knoppen voor weergave en sorteren; staan in de werkbalk én in de plakbalk (zelfde instellingen, één manier)
const viewTabs = () => tabs(S.view, VIEW_OPTIONS, (v) => { setSetting("view", v); render(); });
function sortControls() {
  return [
    select("Sorteer op", S.sort, SORT_OPTIONS, (v) => { setSetting("sort", v); setSetting("sortRev", false); render(); }),
    // Richting-knop: draait Nummer, Alfabet en Waarde om
    SORT_DIRS[S.sort] ? el("button", { type: "button", class: "icon-btn sort-dir", "aria-label": `Volgorde omdraaien, nu ${SORT_DIRS[S.sort][+S.sortRev]}`,
      title: "Volgorde omdraaien", onclick: () => { setSetting("sortRev", !S.sortRev); render(); } }, SORT_DIRS[S.sort][+S.sortRev]) : null,
  ];
}

// ---------- Plakbalk en wegschuivende header (punt 23) ----------
// Plakbalk bovenin het hoofdvlak zodra de grote settitel uit beeld is: setnaam, voortgang en (als er ruimte is) weergave en sorteren
function renderSetbar(bySet) {
  const bar = ui.setbar;
  if (S.nav !== "collection" || S.setsError) return bar.replaceChildren();
  const all = S.setId === ALL, set = all ? null : S.setById[S.setId];
  if (!all && !set) return bar.replaceChildren();
  const total = all ? 0 : setTotal(set), have = all ? 0 : Math.min(bySet[set.id] || 0, total), pct = total ? Math.round((have / total) * 100) : 0;
  const n = Object.keys(S.owned).length;
  bar.replaceChildren(...[
    el("span", { class: "kk-nav-ico", "aria-hidden": "true" }),
    el("span", { class: "setbar-name" }, el("b", {}, all ? "Alle kaarten" : set.name), all ? null : el("small", {}, set.series)),
    el("span", { class: "setbar-count mono" }, all ? `${n} ${n === 1 ? "kaart" : "kaarten"}` : [el("b", {}, have), ` / ${total} · ${pct}%`]),
    all ? null : el("span", { class: "kk-progress-track setbar-track" }, el("span", { class: "kk-progress-fill", style: `width:${pct}%` })),
    // Knoppen werken zelf; een klik erop mag de balk niet naar boven laten springen
    el("span", { class: "setbar-tools", onclick: (e) => e.stopPropagation() }, viewTabs(), ...sortControls())].filter(Boolean));
}

// Bij scrollen in het hoofdvlak: header weg (alleen op brede schermen, via CSS) en plakbalk tonen/verbergen
function onMainScroll() {
  if (!ui.main) return;
  // Header pas terug als je weer helemaal bovenaan bent; niet wisselen terwijl het kaartdetail of het Meer-vel open is
  if (!modal && !moreSheet) ui.app.classList.toggle("head-hidden", ui.main.scrollTop > 60);
  const head = ui.main.querySelector(".sethead");
  const show = !!head && ui.setbar.hasChildNodes() && head.getBoundingClientRect().bottom < ui.main.getBoundingClientRect().top + 8;
  ui.setbar.classList.toggle("on", show);
  ui.setbar.setAttribute("aria-hidden", String(!show));
}

// Uitgelichte kaarten (waaier, topkaart, top 4) op volgorde van de instelling "featBy":
// Zeldzaamheid = bijzonderste eerst, bij gelijke zeldzaamheid de waardevolste; Waarde = precies andersom
function featured(cards) {
  const byRarity = (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity);
  const byWorth = (a, b) => (valueEur(b) ?? -1) - (valueEur(a) ?? -1);
  return [...cards].sort((a, b) => (S.featBy === "value" ? byWorth(a, b) || byRarity(a, b) : byRarity(a, b) || byWorth(a, b)) || a.i - b.i);
}

// Kaartwaaier: de 6 uitgelichte kaarten uit je hele collectie (1–3 links, 4–6 rechts)
function renderFan() {
  // Elke versie telt als eigen kaart, dus een dure reverse holo kan er ook in
  const top = featured(Object.keys(S.owned).map(entryOf).filter(Boolean)).slice(0, 6);
  // Alleen opnieuw opbouwen als de kaarten veranderd zijn, zodat de waaier niet knippert
  const key = top.map((c) => ownedKey(c.id, variantOf(c))).join(",");
  if (key === ui.fanKey) return;
  ui.fanKey = key;
  const fanCard = (c, i) => {
    const label = `${c.name}${variantOf(c) === "reverse" ? " (reverse holo)" : ""} · ${S.setById[parentIdOf(c.setId)]?.name || ""}`;
    return el("button", { type: "button", class: `fan-card f${i} kk-type-${typeKey(c)}`, title: label, "aria-label": label, onclick: () => openModal(c) },
      cardImg(c, { lazy: false }));
  };
  ui.fanLeft.replaceChildren(...top.slice(0, 3).map(fanCard));
  ui.fanRight.replaceChildren(...top.slice(3, 6).map(fanCard));
}

function renderSeries(bySet) {
  const q = S.q.trim().toLowerCase();
  const current = S.cards[S.setId];
  const currentMatches = q && current?.some((c) => c.name.toLowerCase().includes(q));
  const groups = S.series.map((g) => {
    const sets = g.sets.filter((s) => !q || s.name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q) || (s.id === S.setId && currentMatches) ||
      (S.subsets[s.id] || []).some((x) => x.name.toLowerCase().includes(q)));
    const open = q ? true : S.open[g.name] ?? g.sets.some((s) => s.id === S.setId);
    return { g, sets, open };
  }).filter((x) => x.sets.length);

  ui.series.replaceChildren(allItem(), el("span", { class: "all-sep", "aria-hidden": "true" }), ...groups.flatMap(({ g, sets, open }) => [
    el("button", { type: "button", class: "series" + (open ? "" : " closed"), "aria-expanded": String(open), onclick: () => {
      S.open[g.name] = !open; pref.set("open", S.open); render();
    } }, icon(ICONS.chevron, 16), el("span", {}, g.name), el("small", {}, `${g.sets.length} ${g.sets.length === 1 ? "set" : "sets"}`)),
    ...(open ? sets.map((s) => navItem(s, bySet[s.id] || 0)) : []),
  ]));
  if (!groups.length) {
    ui.series.append(el("p", { class: "setpanel-empty" }, S.sets.length ? `Geen set gevonden voor "${S.q}".` : "Sets laden…"));
  }
}

// Vast item bovenaan het setpaneel: je hele collectie in één map
function allItem() {
  const n = Object.keys(S.owned).length;
  return el("button", { type: "button", class: "kk-nav-item all-item", "aria-current": S.nav === "collection" && S.setId === ALL ? "page" : null, onclick: () => pickSet(ALL) },
    el("span", { class: "all-ico", "aria-hidden": "true" }, icon(ICONS.collection, 18)),
    el("span", { class: "kk-nav-lbl" }, el("span", { class: "kk-nav-txt" }, "Alle kaarten"), el("span", { class: "all-sub" }, "Je hele collectie")),
    el("span", { class: "kk-nav-cnt" }, String(n)));
}

function navItem(set, owned) {
  const total = setTotal(set), have = Math.min(owned, total), pct = total ? Math.round((have / total) * 100) : 0;
  return el("button", { type: "button", class: "kk-nav-item kk-nav-prog" + (total && have === total ? " kk-nav-done" : ""), "aria-current": S.nav === "collection" && S.setId === set.id ? "page" : null, title: `${pct}% verzameld`, onclick: () => pickSet(set.id) },
    el("span", { class: "kk-nav-ico", "aria-hidden": "true" }),
    el("span", { class: "kk-nav-lbl" }, el("span", { class: "kk-nav-txt" }, set.name),
      el("span", { class: "kk-nav-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": have, "aria-label": `${pct}% verzameld` }, el("i", { style: `width:${pct}%` }))),
    el("span", { class: "kk-nav-cnt" }, `${have}/${total}`));
}

// Schermen die in een volgende stap gebouwd worden
const LATER = {
  binders: ["Binders", "Je eigen binders, net als in het echt", "Hier maak je straks je eigen binders met sleeves of toploaders en kies je een kaft. Binders komen in stap 7."],
  wish: ["Wensenlijst", "Nog niet gebouwd", "De wensenlijst komt in stap 3, samen met het vernieuwde kaartdetail."],
};

// ---------- Start en Statistiek (stap 2) ----------
// Cijfers over je hele collectie. Aantallen en voortgang kunnen meteen; waardes pas als de kaarten van je sets geladen zijn.
// Een set telt mee als je er minstens één kaart van hebt ("je sets"); een kaartnummer telt één keer, ook met reverse holo
function collectionStats() {
  const bySet = ownedBySet();
  const cards = collectionCards(); // null zolang er nog sets laden
  const worth = {};
  for (const c of cards || []) {
    const id = parentIdOf(c.setId);
    worth[id] = (worth[id] || 0) + (valueEur(c) ?? 0) * countOf(c);
  }
  const sets = Object.keys(bySet).filter((id) => S.setById[id]).map((id) => {
    const set = S.setById[id], total = setTotal(set), have = Math.min(bySet[id], total);
    return { set, have, total, pct: total ? Math.round((have / total) * 100) : 0, done: total > 0 && have === total, value: cards ? worth[id] || 0 : null };
  });
  const copies = Object.values(S.owned).reduce((n, o) => n + o.count, 0);
  return {
    cards, sets, copies,
    kinds: Object.keys(S.owned).length,               // kaarten, elke versie apart (zoals in de header)
    have: sets.reduce((n, s) => n + s.have, 0),       // verschillende kaartnummers
    all: sets.reduce((n, s) => n + s.total, 0),       // alle kaarten in je sets
    complete: sets.filter((s) => s.done).length,
    value: cards ? cards.reduce((sum, c) => sum + (valueEur(c) ?? 0) * countOf(c), 0) : null,
  };
}

// Grote tegel op Start: label, groot getal, uitleg eronder
function statTile(label, big, sub, onclick, holo = false) {
  return el("button", { type: "button", class: "tile" + (holo ? " tile-holo" : ""), onclick },
    el("span", { class: "tile-label" }, label), el("b", {}, big), el("span", { class: "tile-sub" }, sub));
}

const plural = (n, one, more) => `${n} ${n === 1 ? one : more}`;

function renderHome() {
  if (!S.ownedLoaded) return [pageTitle("Welkom terug"), S.ownedError ? null : el("p", { class: "loading" }, "Collectie laden…")];
  const st = collectionStats();
  const out = [pageTitle("Welkom terug", `${plural(st.kinds, "kaart", "kaarten")} · ${st.value == null ? "waarde laden…" : money(st.value)}`)];
  out.push(el("div", { class: "tiles" },
    statTile("Mijn collectie", st.kinds, `kaarten in ${plural(st.sets.length, "set", "sets")}`, () => pickSet(ALL)),
    statTile("Statistiek", st.value == null ? "…" : money(st.value), "totale waarde", () => go("stats")),
    statTile("Wensen", S.wishCount ?? "…", "kaarten op je lijst", () => go("wish")),
    statTile("Sets compleet", st.complete, `van je ${plural(st.sets.length, "set", "sets")}`, () => go("stats"), true)));

  if (!st.kinds) {
    out.push(emptyState("Nog geen kaarten", "Kies bij Collectie een set en voeg je eerste kaart toe, of scan er een. Hier zie je daarna hoe je ervoor staat."));
    return out;
  }

  // Bezig met: sets die nog niet af zijn, het verst gevorderd eerst
  const busy = st.sets.filter((s) => !s.done).sort((a, b) => b.have / b.total - a.have / a.total || b.have - a.have).slice(0, 3);
  if (busy.length) {
    out.push(el("h3", { class: "section" }, "Bezig met"),
      el("div", { class: "busy" }, busy.map((s) => el("button", { type: "button", class: "plain", "aria-label": `Open ${s.set.name}`, onclick: () => pickSet(s.set.id) },
        setProgress(s.set.name, s.have, s.total)))));
  }

  // Je waardevolste kaarten: alleen op waarde, elke versie telt als eigen kaart
  out.push(el("h3", { class: "section" }, "Je waardevolste kaarten"));
  if (!st.cards) out.push(el("p", { class: "loading" }, "Kaarten laden…"));
  else {
    const top = [...st.cards].sort((a, b) => (valueEur(b) ?? -1) - (valueEur(a) ?? -1) || a.i - b.i).slice(0, 5);
    out.push(el("div", { class: "kk-grid top-grid" }, top.map((c) => cardTile(c))));
  }
  return out;
}

function renderStats() {
  const head = pageTitle("Statistiek", "Je hele collectie in cijfers");
  if (!S.ownedLoaded) return [head, S.ownedError ? null : el("p", { class: "loading" }, "Collectie laden…")];
  const st = collectionStats();
  if (!st.kinds) return [head, emptyState("Nog geen kaarten", "Zodra je kaarten hebt, zie je hier je totale waarde, je voortgang per set en de verdeling per zeldzaamheid.")];
  const out = [head];

  // Twee grote vakken: totale waarde en kaarten verzameld
  const pctAll = st.all ? Math.round((st.have / st.all) * 100) : 0;
  out.push(el("div", { class: "bigstats" },
    el("section", { class: "panel bigstat" },
      el("span", { class: "tile-label" }, "Totale waarde"),
      el("b", { class: "bignum" }, st.value == null ? "…" : money(st.value)),
      el("span", { class: "tile-sub" }, `${plural(st.copies, "stuk", "stuks")}` + (st.value == null ? "" : ` · gemiddeld ${money(st.value / st.copies)} per stuk`))),
    el("section", { class: "panel bigstat" },
      el("span", { class: "tile-label" }, "Kaarten"),
      el("b", { class: "bignum" }, st.have, el("small", {}, ` / ${st.all}`)),
      el("span", { class: "tile-sub" }, `je hebt ${pctAll}% van alle kaarten in je sets · ${plural(st.complete, "set", "sets")} compleet`),
      setProgress("Al je sets", st.have, st.all))));

  // Per editie: je sets, het verst gevorderd eerst; klik opent de set
  const rows = [...st.sets].sort((a, b) => b.pct - a.pct || b.have - a.have || a.set.name.localeCompare(b.set.name));
  out.push(el("section", { class: "panel" },
    el("div", { class: "panel-head" },
      el("h3", { class: "section" }, "Per editie"),
      el("button", { type: "button", class: "kk-btn kk-btn-primary", onclick: () => toast("Editie toevoegen komt in stap 6") }, "+ Editie toevoegen")),
    el("div", { class: "erows", role: "table", "aria-label": "Je sets" },
      el("div", { class: "erow ehead", role: "row" }, el("span", { class: "col-code" }, "Code"), el("span", {}, "Editie"), el("span", { class: "col-series" }, "Serie"),
        el("span", {}, "In bezit"), el("span", { class: "col-prog" }, "Voortgang"), el("span", { style: "text-align:right" }, "Waarde")),
      rows.map((s) => el("button", { type: "button", class: "erow", "aria-label": `${s.set.name}: ${s.have} van ${s.total}, ${s.pct}% verzameld`, onclick: () => pickSet(s.set.id) },
        el("span", { class: "col-code" }, el("span", { class: "code" }, s.set.id.toUpperCase())),
        el("span", { class: "lname" }, s.set.name),
        el("span", { class: "esub col-series" }, s.set.series),
        el("span", { class: "mono" }, `${s.have} / ${s.total}`),
        el("span", { class: "eprog col-prog" }, el("span", { class: "ebar" + (s.done ? " done" : "") }, el("i", { style: `width:${s.pct}%` })), el("span", { class: "mono epct" }, s.pct + "%")),
        el("span", { class: "mono lval" }, s.value == null ? "…" : money(s.value)))))));

  // Per zeldzaamheid: aantal kaarten (elke versie apart) per niveau van de ladder; "Overig" = niet op de ladder (bv. Promo)
  const perTier = new Array(TIER_NAMES.length + 1).fill(0);
  for (const c of st.cards || []) perTier[rarityRank(c.rarity)]++;
  const tierRows = [...TIER_NAMES.map((name, i) => [chip(name), perTier[i + 1]]), ...(perTier[0] ? [[el("span", { class: "kk-chip kk-chip-tier-c" }, el("span", {}, "Overig")), perTier[0]]] : [])];
  const maxN = Math.max(1, ...tierRows.map(([, n]) => n));
  out.push(el("section", { class: "panel" },
    el("h3", { class: "section" }, "Per zeldzaamheid"),
    st.cards ? tierRows.map(([label, n]) => el("div", { class: "barrow" },
      el("span", { class: "barlabel" }, label),
      el("span", { class: "bartrack", role: "img", "aria-label": `${n} kaarten` }, el("i", { style: `width:${Math.round((n / maxN) * 100)}%` })),
      el("span", { class: "mono barnum" }, n)))
      : el("p", { class: "loading" }, "Kaarten laden…")));
  return out;
}

// ---------- Instellingen (punt 20) ----------
// Eén regel: label met korte uitleg links, de keuze rechts (op de telefoon eronder)
function settingRow(label, help, control) {
  return el("div", { class: "set-row" },
    el("div", { class: "set-text" }, el("b", {}, label), help ? el("span", {}, help) : null),
    el("div", { class: "set-ctrl" }, control));
}

// Instelling wijzigen vanuit de Instellingen-pagina: opslaan, scherm bijwerken en kort melden
function changeSetting(key, value) {
  setSetting(key, value);
  render();
  toast("Opgeslagen");
}

const ON_OFF = [{ value: "on", label: "Aan" }, { value: "off", label: "Uit" }];
const settingsGroup = (title, ...rows) => el("section", { class: "settings-box" }, el("h3", {}, title), ...rows);

function renderSettings() {
  const meta = S.meta || {};
  const dateTxt = (iso) => (iso ? new Date(iso + "T12:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "onbekend");
  return [pageTitle("Instellingen", "Stashdex naar jouw smaak"),
    settingsGroup("Mijn collectie",
      settingRow("Uitgelichte kaarten kiezen op", "Bepaalt de kaartwaaier bovenin, de topkaart en de top 4 van een set.",
        segmented("Uitgelichte kaarten kiezen op", S.featBy, FEAT_OPTIONS, (v) => changeSetting("featBy", v))),
      settingRow("Download mijn collectie", "Al je kaarten als bestand (CSV), te openen in Excel of Google Spreadsheets. Handig als extra back-up.",
        el("button", { type: "button", class: "kk-btn kk-btn-ghost", onclick: downloadCollection }, "Download (CSV)"))),
    settingsGroup("Weergave",
      settingRow("Valuta", "Prijzen komen in euro's van Cardmarket; dollars worden omgerekend met de koers van de ECB."
        + (S.cur === "USD" && S.rate.date ? " Koers van " + dateTxt(S.rate.date) + "." : ""),
        segmented("Valuta", S.cur, [{ value: "EUR", label: "€" }, { value: "USD", label: "$" }], (v) => changeSetting("cur", v))),
      settingRow("\"Nog niet\"-kaarten tonen", "Uit = in een set alleen de kaarten die je hebt.",
        segmented("Nog niet-kaarten tonen", S.showMissing ? "on" : "off", ON_OFF, (v) => changeSetting("showMissing", v === "on"))),
      settingRow("Holo en kantelen", calmQuery.matches ? "Je apparaat staat op \"minder beweging\", daarom staat dit nu altijd uit."
        : "Rustig = zachtere holo en minder kantelen; Uit = geen holo-beweging en niet kantelen.",
        segmented("Holo en kantelen", S.motion, [{ value: "on", label: "Aan" }, { value: "calm", label: "Rustig" }, { value: "off", label: "Uit" }], (v) => changeSetting("motion", v))),
      settingRow("Thema", "Automatisch volgt de instelling van je apparaat.",
        segmented("Thema", S.theme, [{ value: "light", label: "Licht" }, { value: "dark", label: "Donker" }, { value: "auto", label: "Automatisch" }], (v) => changeSetting("theme", v)))),
    settingsGroup("Account", ...accountRows()),
    settingsGroup("Over Stashdex",
      el("p", { class: "set-about" }, `Prijzen bijgewerkt op ${dateTxt(meta.pricesDate)}. `,
        meta.eurUsd ? `Koers: 1 euro = ${meta.eurUsd.toLocaleString("nl-NL", { maximumFractionDigits: 4 })} dollar (${dateTxt(meta.rateDate)}).` : ""),
      el("p", { class: "set-about" }, "Bronnen: TCGdex (kaarten), Cardmarket (prijzen), Europese Centrale Bank (koers)."),
      el("p", { class: "set-about" }, "Stashdex is een eigen project en heeft geen band met The Pokémon Company.")),
  ];
}

// Account: e-mailadres en wachtwoord wijzigen, uitloggen op alle apparaten, account verwijderen
function accountRows() {
  const emailInput = el("input", { class: "kk-input", type: "email", value: S.email, autocomplete: "email", "aria-label": "Nieuw e-mailadres" });
  const emailForm = el("form", { class: "set-inline", onsubmit: async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email || email === S.email) return toast("Vul een ander e-mailadres in");
    const btn = emailForm.querySelector("button");
    btn.disabled = true;
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname });
    btn.disabled = false;
    toast(error ? `Wijzigen mislukt: ${error.message}` : "Kijk in je mail (oude én nieuwe adres) om de wijziging te bevestigen");
  } }, emailInput, el("button", { type: "submit", class: "kk-btn kk-btn-ghost" }, "Wijzigen"));

  return [
    settingRow("E-mailadres", "Je krijgt een mail om het nieuwe adres te bevestigen.", emailForm),
    settingRow("Wachtwoord", null, el("button", { type: "button", class: "kk-btn kk-btn-ghost", onclick: () => openPasswordChange() }, "Wachtwoord wijzigen")),
    settingRow("Uitloggen op alle apparaten", "Handig als je ergens bent ingelogd gebleven, bijvoorbeeld op een andere computer.",
      el("button", { type: "button", class: "kk-btn kk-btn-ghost", onclick: async () => {
        const ok = await confirmDialog({ title: "Uitloggen op alle apparaten?", text: "Je wordt overal uitgelogd, ook hier. Je collectie blijft gewoon bewaard.", confirm: "Overal uitloggen" });
        if (ok) await supabase.auth.signOut({ scope: "global" });
      } }, "Overal uitloggen")),
    settingRow("Account verwijderen", "Je collectie, wensenlijst, binders en instellingen worden definitief gewist.",
      el("button", { type: "button", class: "kk-btn kk-btn-danger", onclick: async () => {
        const ok = await confirmDialog({ title: "Account verwijderen?", text: "Je collectie, wensenlijst, binders en instellingen worden definitief gewist. Dit kan niet ongedaan worden gemaakt.",
          confirm: "Definitief verwijderen", danger: true, typeWord: "VERWIJDER" });
        if (!ok) return;
        const { error } = await supabase.rpc("delete_my_account");
        if (error) return toast(`Verwijderen mislukt: ${error.message}`);
        await supabase.auth.signOut({ scope: "local" });
        window.dispatchEvent(new CustomEvent("stashdex-toast", { detail: "Je account is verwijderd" }));
      } }, "Account verwijderen")),
  ];
}

// Bevestigingsvenster; met typeWord moet je eerst dat woord typen. Geeft true (bevestigd) of false.
function confirmDialog({ title, text, confirm, danger = false, typeWord = null }) {
  return new Promise((resolve) => {
    closeModal();
    const done = (ok) => { resolve(ok); closeModal(); };
    const okBtn = el("button", { type: "button", class: `kk-btn ${danger ? "kk-btn-danger" : "kk-btn-primary"}`, disabled: !!typeWord, onclick: () => done(true) }, confirm);
    const input = typeWord ? el("input", { class: "kk-input", autocomplete: "off", spellcheck: "false",
      oninput: (e) => { okBtn.disabled = e.target.value.trim() !== typeWord; } }) : null;
    const scrim = el("div", { class: "kk-scrim", onclick: (e) => { if (e.target === scrim) done(false); } },
      el("div", { class: "kk-modal confirm-box", role: "alertdialog", "aria-modal": "true", "aria-label": title },
        el("h2", {}, title), el("p", {}, text),
        input ? el("label", { class: "fld" }, el("span", { class: "flabel" }, `Typ ${typeWord} om te bevestigen`), input) : null,
        el("div", { class: "confirm-actions" },
          el("button", { type: "button", class: "kk-btn kk-btn-ghost", onclick: () => done(false) }, "Annuleren"), okBtn)));
    modal = { scrim, returnFocus: document.activeElement, onClose: () => resolve(false) };
    document.body.append(scrim);
    (input || okBtn).focus();
  });
}

// Maakt het CSV-bestand in de browser (puntkomma's en decimale komma's, zoals Nederlandse Excel verwacht)
async function downloadCollection(e) {
  const btn = e.currentTarget;
  if (!S.ownedLoaded) return toast("Je collectie wordt nog geladen, probeer het zo nog eens");
  btn.disabled = true;
  try {
    await loadOwnedSets(); // namen en marktprijzen van alle sets waar je kaarten van hebt
    const cell = (v) => { const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v); return /[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
    const rows = Object.entries(S.owned).sort(([a], [b]) => a.localeCompare(b, "nl", { numeric: true })).map(([key, o]) => {
      const [id, variant] = splitKey(key), card = entryOf(key);
      return [id, variant, card?.name, S.setById[setIdOf(id)]?.name, card?.number, o.count, card?.eur];
    });
    const lines = [["card_id", "variant", "naam", "set", "nummer", "aantal", "marktprijs_eur"], ...rows].map((r) => r.map(cell).join(";"));
    // BOM vooraan, zodat Excel de é van Pokémon goed toont
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    el("a", { href: url, download: `stashdex-collectie-${new Date().toLocaleDateString("sv-SE")}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${rows.length} kaarten gedownload`);
  } finally {
    btn.disabled = false;
  }
}

function renderMain(bySet) {
  const out = [];
  if (S.ownedError) out.push(emptyState("Er ging iets mis", S.ownedError));
  if (S.nav === "settings") return [...out, ...renderSettings()];
  if (S.nav === "home") return [...out, ...renderHome()];
  if (S.nav === "stats") return [...out, ...renderStats()];
  if (S.nav !== "collection") {
    const [title, sub, text] = LATER[S.nav];
    return [...out, pageTitle(title, sub), emptyState("Komt eraan", text)];
  }
  if (S.setsError) return [...out, emptyState("Er ging iets mis", S.setsError)];
  const all = S.setId === ALL;
  const set = all ? null : S.setById[S.setId];
  if (!all && !set) return [...out, el("p", { class: "loading" }, "Sets laden…")];
  if (all && (!S.sets.length || (!S.ownedLoaded && !S.ownedError))) return [...out, el("p", { class: "loading" }, "Collectie laden…")];

  const total = all ? 0 : setTotal(set);
  const parts = all ? [] : (S.subsets[set.id] || []).map((s) => s.part);
  const cards = all ? collectionCards() : S.cards[set.id] && withReverses(S.cards[set.id]);

  // Kop van de set: titel + voortgang + nummer 2 t/m 4 links, rechts de topkaart.
  // Volgorde naar keuze: zeldzaamste eerst (bij gelijke zeldzaamheid de hoogste waarde), of alleen de hoogste waarde
  const ranked = featured((cards || []).filter((c) => countOf(c)));
  const feat = ranked[0], podium = ranked.slice(1, 4);
  out.push(el("div", { class: "sethead" + (feat ? "" : " sethead-solo") },
    el("div", { class: "sethead-main" },
      all ? pageTitle("Alle kaarten", "Je hele collectie · alle sets")
        : pageTitle(set.name, `${set.series} · ${total} kaarten` + (parts.length ? ` · incl. ${parts.join(", ")}` : "")),
      all ? collectionSummary(cards) : setProgress(set.name, bySet[set.id] || 0, total),
      feat ? el("div", { class: "podium-head" },
        el("span", { class: "podium-label" }, "Top 4 op"),
        // Snelle schakelaar; slaat dezelfde instelling op als "Uitgelichte kaarten kiezen op" in Instellingen
        segmented("Top 4 op", S.featBy, FEAT_OPTIONS, (v) => { setSetting("featBy", v); render(); })) : null,
      podium.length ? el("div", { class: "podium", role: "list", "aria-label": `Nummer 2 tot en met 4 uit je collectie${all ? "" : " van deze set"}` },
        podium.map((c, i) => miniCard(c, i + 2))) : null),
    feat ? el("div", { class: "feat" },
      el("span", { class: "feat-badge" }, all ? "Topkaart van je collectie" : "Topkaart van deze set"),
      el("div", { class: "feat-card" }, cardTile(feat, { foil: true, holoMin: 0.7 }))) : null));

  if (all && cards && !cards.length) {
    out.push(emptyState("Nog geen kaarten", "Kies een set in het setpaneel en voeg je eerste kaart toe; hier zie je daarna je hele collectie."));
    return out;
  }
  if (!cards) {
    out.push(!all && S.cardsError[set.id] ? emptyState("Er ging iets mis", S.cardsError[set.id]) : el("p", { class: "loading" }, "Kaarten laden…"));
    return out;
  }

  // Werkbalk: weergave, sorteren, filter
  const filtered = S.own !== "all" || S.typeF !== "all";
  out.push(el("div", { class: "toolbar" },
    viewTabs(),
    el("div", { class: "toolbar-gap" }),
    ...sortControls(),
    el("button", { type: "button", class: "icon-btn" + (S.filterOpen || filtered ? " on" : ""), "aria-label": "Filter", "aria-pressed": String(S.filterOpen), onclick: () => { S.filterOpen = !S.filterOpen; render(); } }, icon(ICONS.filter))));

  // Filteren en sorteren
  const q = S.q.trim().toLowerCase();
  const setMatches = q && !all && set.name.toLowerCase().includes(q);
  let list = cards.filter((c) => {
    const n = countOf(c);
    // Bij "Alle kaarten" zoek je ook op setnaam
    if (q && !setMatches && !c.name.toLowerCase().includes(q) && !(all && c.group.toLowerCase().includes(q))) return false;
    if (S.own === "have" && !n) return false;
    if (S.own === "need" && n) return false;
    // Instelling '"Nog niet"-kaarten tonen' uit: alleen je eigen kaarten (behalve als je zelf filtert op "Nog niet")
    if (!S.showMissing && S.own === "all" && !n) return false;
    if (S.typeF !== "all" && typeName(c) !== S.typeF) return false;
    return true;
  });
  // rev = -1 draait de volgorde om; kaarten zonder prijs staan bij Waarde altijd achteraan
  const rev = SORT_DIRS[S.sort] && S.sortRev ? -1 : 1;
  const sorters = {
    number: (a, b) => rev * (a.i - b.i),
    name: (a, b) => rev * a.name.localeCompare(b.name) || a.i - b.i,
    value: (a, b) => {
      const va = valueEur(a), vb = valueEur(b);
      if (va == null || vb == null) return (va == null) - (vb == null) || a.i - b.i;
      return rev * (vb - va) || a.i - b.i;
    },
    rarity: (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.i - b.i,
    type: (a, b) => typeName(a).localeCompare(typeName(b)) || a.i - b.i,
  };
  list = list.sort(sorters[S.sort] || sorters.number);

  if (S.filterOpen) {
    out.push(el("div", { class: "filterbar" },
      all ? null : segmented("Bezit", S.own, [{ value: "all", label: "Alles" }, { value: "have", label: "In bezit" }, { value: "need", label: "Nog niet" }], (v) => {
        S.own = v; S.shown = PAGE; render();
      }),
      select("Type", S.typeF, [{ value: "all", label: "Alle types" }, ...TYPES.map((t) => ({ value: t, label: t }))], (v) => {
        S.typeF = v; S.shown = PAGE; render();
      }),
      el("span", { style: "flex-grow:1" }),
      el("span", { class: "count-note" }, `${list.length} van ${cards.length} kaarten`),
      el("button", { type: "button", class: "linkbtn", onclick: () => {
        S.own = "all"; S.typeF = "all"; S.q = ""; ui.search.value = ""; S.shown = PAGE; render();
      } }, "Filters wissen")));
  }

  if (!list.length) {
    out.push(emptyState("Geen kaarten gevonden", "Pas je zoekterm of filters aan om weer kaarten te zien."));
    return out;
  }

  const limit = S.view === "grid" ? S.shown * 3 : S.shown;
  const shown = list.slice(0, limit);
  if (S.view === "list") {
    out.push(el("div", { class: "listbox", role: "table", "aria-label": "Kaarten" },
      el("div", { class: "lrow lhead", role: "row" }, el("span", {}, "Nr"), el("span", {}, "Naam"), el("span", { class: "col-type" }, "Type"),
        el("span", { class: "col-rar" }, "Zeldzaamheid"), el("span", {}, "Aantal"), el("span", { style: "text-align:right" }, "Waarde")),
      withHeadings(shown, (part) => el("div", { class: "lrow lpart", role: "row" }, part), (c) => {
        const n = countOf(c);
        return el("button", { type: "button", class: "lrow" + (n ? "" : " lmiss"), onclick: () => openModal(c) },
          el("span", { class: "mono" }, numTxt(c)), el("span", { class: "lname" }, c.name, variantOf(c) === "reverse" ? rhTag() : null),
          el("span", { class: "col-type" }, el("i", { class: `tdot kk-type-${typeKey(c)}` }), typeName(c)),
          el("span", { class: "col-rar" }, chip(c.rarity)),
          el("span", { class: "mono" }, n ? n + "×" : "—"),
          el("span", { class: "mono lval" }, money(valueEur(c)) ?? "—"));
      })));
  } else if (S.view === "grid") {
    out.push(el("div", { class: "raster" }, withHeadings(shown, partTitle, (c) =>
      el("button", { type: "button", class: `thumb kk-type-${typeKey(c)}` + (countOf(c) ? "" : " tmiss"), "aria-label": c.name + (variantOf(c) === "reverse" ? " (reverse holo)" : ""), title: c.name, onclick: () => openModal(c) },
        cardImg(c), variantOf(c) === "reverse" ? rhTag() : null, el("span", { class: "mono" }, numTxt(c))))));
  } else {
    out.push(el("div", { class: "kk-grid" }, withHeadings(shown, partTitle, cardTile)));
  }

  if (list.length > limit) {
    out.push(el("div", { class: "more" },
      el("button", { type: "button", class: "kk-btn kk-btn-ghost", onclick: () => { S.shown += PAGE; render(); } }, `Toon meer (${list.length - limit} over)`)));
  }
  return out;
}

// ---------- Navigatie ----------

function go(nav) {
  S.nav = nav;
  render();
  ui.main.scrollTop = 0; // een andere pagina begint bovenaan
  if (nav === "collection") loadCards(S.setId);
  // Start en Statistiek rekenen met de kaarten van al je sets (ook een set die je net via scannen hebt toegevoegd)
  if (nav === "home" || nav === "stats") loadOwnedSets();
}

// ---------- Meer-vel (alleen op de telefoon): Binders, Statistiek, Instellingen, Uitloggen ----------
let moreSheet = null;

function openMore() {
  const item = (key, label, action) => el("button", { type: "button", class: "more-item", onclick: () => { closeMore(); action(); } }, icon(ICONS[key]), label);
  moreSheet = el("div", { class: "more-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Meer", onclick: (e) => { if (e.target === moreSheet) closeMore(); } },
    el("div", { class: "more-panel" }, el("div", { class: "more-grip" }),
      item("binders", "Binders", () => go("binders")),
      item("stats", "Statistiek", () => go("stats")),
      item("settings", "Instellingen", () => go("settings")),
      item("logout", "Uitloggen", () => supabase.auth.signOut())));
  document.body.append(moreSheet);
  ui.more.setAttribute("aria-expanded", "true");
  moreSheet.querySelector(".more-item").focus();
}

function closeMore() {
  if (!moreSheet) return;
  moreSheet.remove();
  moreSheet = null;
  ui.more.setAttribute("aria-expanded", "false");
  ui.more.focus();
}

function pickSet(id) {
  S.nav = "collection";
  setSetting("set", id);
  S.shown = PAGE;
  render();
  ui.main.scrollTop = 0;
  loadCards(id);
}

// Aantal van een kaart (in één versie) opslaan in Supabase en in S.owned; 0 = uit je collectie halen.
// Geeft de fout terug, of null als het gelukt is
async function storeCount(cardId, variant, count) {
  const { error } = count > 0
    ? await supabase.from("collection")
      .upsert({ user_id: S.userId, card_id: cardId, variant, count, updated_at: new Date().toISOString() }, { onConflict: "user_id,card_id,variant" })
    : await supabase.from("collection").delete().eq("user_id", S.userId).eq("card_id", cardId).eq("variant", variant);
  if (error) return error;
  const key = ownedKey(cardId, variant);
  if (count > 0) S.owned[key] = { ...S.owned[key], count };
  else delete S.owned[key];
  return null;
}

// ---------- Kaartdetail: aantal aanpassen, toevoegen of verwijderen ----------
let modal = null;
let modalSwitching = false; // true terwijl het kaartdetail naar de andere versie wisselt

// card kan de gewone versie of de reverse holo zijn; returnFocus blijft bewaard bij wisselen van versie
function openModal(card, returnFocus = document.activeElement) {
  closeModal(false);
  const variant = variantOf(card), rev = variant === "reverse";
  const base = S.cardById[card.id] || card;           // de gewone versie, voor het wisselen
  const label = card.name + (rev ? " (reverse holo)" : "");
  const set = S.setById[parentIdOf(setIdOf(card.id))];
  const where = card.part ? `${set?.name || ""} · ${card.part} · ${numTxt(card)}` : `${set?.name || ""} · #${card.number}/${set?.printedTotal || set?.total || "?"}`;
  const have = countOf(card);
  let count = Math.max(1, have);
  const t = tier(card.rarity);
  const countEl = el("b", { class: "mono" }, count);
  const setCount = (n) => { count = n; countEl.textContent = n; };

  const actions = el("div", { class: "kk-full modal-actions" });
  const setBusy = (on) => actions.querySelectorAll("button").forEach((b) => (b.disabled = on));

  async function save() {
    setBusy(true);
    const error = await storeCount(card.id, variant, count);
    setBusy(false);
    if (error) return toast(`Opslaan mislukt: ${error.message}`);
    closeModal();
    render();
    toast(have ? `${label} opgeslagen` : `${label} staat nu in je collectie`);
  }

  async function remove() {
    setBusy(true);
    const error = await storeCount(card.id, variant, 0);
    setBusy(false);
    if (error) return toast(`Verwijderen mislukt: ${error.message}`);
    closeModal();
    render();
    toast(`${label} is uit je collectie gehaald`);
  }

  // Keuze Normaal · Reverse holo, alleen als er een reverse holo bestaat (of als je er een hebt)
  const hasRev = base.rev || S.owned[ownedKey(card.id, "reverse")];
  const versions = hasRev
    ? el("div", { class: "kk-full modal-variant" },
      segmented("Versie", variant, Object.entries(VARIANT_LABEL).map(([value, text]) => ({ value, label: text })), (v) => {
        if (v === variant) return;
        modalSwitching = true;
        openModal(v === "reverse" ? revOf(base) : base, modal?.returnFocus ?? returnFocus);
      }))
    : null;

  actions.append(
    el("button", { type: "button", class: "kk-btn kk-btn-primary", onclick: save }, have ? "Opslaan" : "Toevoegen aan collectie"),
    have ? el("button", { type: "button", class: "kk-btn kk-btn-danger", onclick: remove }, "Verwijderen") : null);

  const closeBtn = el("button", { type: "button", class: "kk-modal-close", "aria-label": "Sluiten", onclick: closeModal }, "×");
  const scrim = el("div", { class: "kk-scrim", onclick: (e) => { if (e.target === scrim) closeModal(); } },
    el("div", { class: "kk-modal", role: "dialog", "aria-modal": "true", "aria-label": label },
      closeBtn,
      el("div", { class: "kk-modal-art" + (t?.band ? " kk-holo-" + t.band : "") + (rev ? " kk-modal-rev" : ""), style: `--kk-holo-max:${card.rarity ? holoLevel(card.rarity) : 0.55}` },
        cardImg(card, { large: true, lazy: false }), rev ? rhSheen() : null, rev ? rhTag() : null),
      el("h2", {}, card.name),
      el("div", { class: "kk-modal-sub" }, `${where} · ${card.rarity || "—"}` + (rev ? " · Reverse holo" : "")),
      el("div", { class: "kk-fieldgrid" },
        versions,
        el("div", { class: "kk-full stepper-wrap" },
          el("span", { class: "flabel" }, "Aantal"),
          el("div", { class: "stepper" },
            el("button", { type: "button", "aria-label": "Eén minder", onclick: () => setCount(Math.max(1, count - 1)) }, "−"),
            countEl,
            el("button", { type: "button", "aria-label": "Eén meer", onclick: () => setCount(count + 1) }, "+")),
          el("span", { class: "flabel", style: "margin-left:auto" }, "Waarde"),
          el("b", { class: "mono", style: "color:var(--red)" }, money(valueEur(card)) ?? "—")),
        el("div", { class: "kk-full" }, priceChart(card)),
        actions)));

  modal = { scrim, returnFocus };
  document.body.append(scrim);
  // Na wisselen van versie blijft de focus op de versieknop, anders op de sluitknop
  (versions && modalSwitching ? versions.querySelector("[aria-pressed=true]") : closeBtn).focus();
  modalSwitching = false;
}

// ---------- Prijsgrafiek in het kaartdetail ----------

// Prijsgeschiedenis van een set, één keer per set opgehaald
function loadHistory(setId) {
  return (S.history[setId] ||= fetch(`data/history/${encodeURIComponent(setId)}.json`, { cache: "no-cache" })
    .then((res) => (res.status === 404 ? null : res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .catch((err) => { delete S.history[setId]; throw err; }));
}

const dayLabel = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });

// Grafiek met de Cardmarket-trendprijs; periode kiezen met 7D · 1M · 3M · 6M · 1J · Alles
function priceChart(card) {
  const box = el("div", { class: "chart" }, el("p", { class: "chart-note" }, "Prijsverloop laden…"));
  loadHistory(card.setId).then((hist) => {
    const all = [];
    // Per kaart { n: normale versie, r: reverse holo }; een oud bestand heeft alleen een rij (= normaal)
    const entry = hist?.prices?.[card.id];
    const series = (Array.isArray(entry) ? (variantOf(card) === "reverse" ? [] : entry) : entry?.[variantOf(card) === "reverse" ? "r" : "n"]) || [];
    (hist?.dates || []).forEach((d, i) => { if (series[i] != null) all.push({ d, v: series[i] }); });
    const draw = () => {
      const days = Object.fromEntries(PERIODS)[S.period] ?? 30;
      const last = all.at(-1);
      const from = last ? new Date(Date.parse(last.d) - days * 864e5).toISOString().slice(0, 10) : "";
      const pts = all.filter((p) => days === Infinity || p.d >= from);
      const head = el("div", { class: "chart-head" },
        el("span", { class: "flabel" }, "Prijsverloop"),
        segmented("Periode", S.period, PERIODS.map(([label]) => ({ value: label, label })), (v) => {
          setSetting("period", v); draw();
        }));
      if (pts.length < 2) {
        const since = all[0] ? ` sinds ${dayLabel(all[0].d)}` : "";
        box.replaceChildren(head, el("p", { class: "chart-note" },
          all.length ? `Stashdex houdt de prijs${since} elke nacht bij. Na een paar dagen verschijnt hier de grafiek.`
            : "Voor deze kaart is (nog) geen marktprijs bekend."));
        return;
      }
      box.replaceChildren(head, chartSvg(pts));
    };
    draw();
  }).catch(() => box.replaceChildren(el("p", { class: "chart-note" }, "Het prijsverloop kon niet geladen worden.")));
  return box;
}

// Tekent de lijn met een zachte vulling; muis of vinger erover toont prijs en datum
function chartSvg(pts) {
  const W = 400, H = 150, P = 6;
  const vals = pts.map((p) => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || hi || 1;
  const t0 = Date.parse(pts[0].d), t1 = Date.parse(pts.at(-1).d);
  const x = (p) => P + ((Date.parse(p.d) - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const first = vals[0], lastV = vals.at(-1);
  const change = first ? ((lastV - first) / first) * 100 : 0;
  const trend = change > 0.05 ? "up" : change < -0.05 ? "down" : "flat";
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const ns = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img",
    "aria-label": `Prijsverloop van ${money(first)} naar ${money(lastV)}` });
  svg.append(svgEl("path", { d: `${line}L${x(pts.at(-1)).toFixed(1)},${H}L${x(pts[0]).toFixed(1)},${H}Z`, class: "chart-area" }),
    svgEl("path", { d: line, class: "chart-line" }));
  const guide = svgEl("line", { y1: 0, y2: H, class: "chart-guide" });
  const dot = svgEl("circle", { r: 4.5, class: "chart-dot" });
  svg.append(guide, dot);

  const tip = el("div", { class: "chart-tip" });
  const show = (p) => {
    const px = x(p), py = y(p.v);
    guide.setAttribute("x1", px); guide.setAttribute("x2", px);
    dot.setAttribute("cx", px); dot.setAttribute("cy", py);
    tip.replaceChildren(el("b", {}, money(p.v)), " ", dayLabel(p.d));
  };
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) / r.width * W - P) / (W - 2 * P) * (t1 - t0);
    show(pts.reduce((a, b) => (Math.abs(Date.parse(b.d) - t) < Math.abs(Date.parse(a.d) - t) ? b : a)));
  });
  svg.addEventListener("pointerleave", () => show(pts.at(-1)));
  show(pts.at(-1));

  const sign = change > 0 ? "+" : "";
  return el("div", { class: `chart-wrap chart-${trend}` },
    el("div", { class: "chart-stats" },
      tip,
      el("span", { class: "chart-change" }, `${sign}${change.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`)),
    svg,
    el("div", { class: "chart-range" }, el("span", {}, dayLabel(pts[0].d)), el("span", {}, `laag ${money(lo)} · hoog ${money(hi)}`), el("span", {}, dayLabel(pts.at(-1).d))),
    el("p", { class: "chart-note" }, "Cardmarket-trendprijs, elke nacht bijgewerkt."));
}

// restore = focus teruggeven aan waar je vandaan kwam (niet bij het wisselen van versie)
function closeModal(restore = true) {
  if (!modal) return;
  modal.scrim.remove();
  modal.onClose?.(); // bevestigingsvenster dicht zonder keuze = "nee"
  const back = modal.returnFocus;
  modal = null;
  if (restore && back?.isConnected) back.focus();
}

// ---------- Scannen (stap 5): camera, herkennen, bevestigen en doorscannen ----------
let scan = null; // toestand van het scanscherm zolang het open is

// Alle kaarten kort (data/scan.json) om in te zoeken; één keer geladen. Nieuwste set eerst: die wint bij twijfel
let scanPool = null;
function loadScanPool() {
  return (scanPool ||= fetch("data/scan.json", { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((rows) => rows.map(([id, name, number]) => {
      const own = setIdOf(id), set = parentIdOf(own);
      return { id, name, number, set, total: S.setById[own]?.printedTotal, rel: S.setById[set]?.releaseDate || "" };
    }).filter((c) => S.setById[c.set]).sort((a, b) => b.rel.localeCompare(a.rel)))
    .catch((err) => { scanPool = null; throw err; }));
}

function openScan() {
  if (!S.sets.length) return toast("De sets worden nog geladen, probeer het zo nog eens");
  closeMore();
  closeModal(false);
  // Standaard zoeken in de set die open staat; in "Alle kaarten" of op een ander scherm in alle sets
  const inSet = S.nav === "collection" && S.setId !== ALL;
  const s = scan = {
    scope: inSet ? "set" : "all",
    setId: S.setId !== ALL ? S.setId : S.series[0]?.sets[0]?.id,
    stage: "camera",   // camera · busy (herkennen) · result
    stream: null, camError: null, photo: null, read: null, result: null, pick: null, variant: "normal",
    saving: false, added: [], sessionOpen: false,
  };
  s.video = el("video", { class: "scan-video", playsinline: true, muted: true, autoplay: true, "aria-hidden": "true" });
  s.video.muted = true;
  // Kaartvormig kader met vier hoekjes
  s.frame = el("div", { class: "scan-frame", "aria-hidden": "true" }, el("i"), el("i"), el("i"), el("i"));
  s.body = el("div", { class: "scan-body" });
  const scrim = el("div", { class: "kk-scrim scan-scrim", onclick: (e) => { if (e.target === scrim) closeModal(); } },
    el("div", { class: "kk-modal scan-dlg", role: "dialog", "aria-modal": "true", "aria-labelledby": "scan-title" },
      el("button", { type: "button", class: "kk-modal-close", "aria-label": "Sluiten", onclick: () => closeModal() }, "×"),
      el("h2", { id: "scan-title" }, "Kaart scannen"),
      s.body));
  modal = { scrim, returnFocus: document.activeElement, onClose: endScan };
  document.body.append(scrim);
  renderScan(true);
  startScanCamera(s);
  // Leesprogramma en kaartenlijst alvast laden, zodat de eerste scan sneller gaat
  prepareOcr().catch(() => {});
  loadScanPool().catch(() => {});
}

// Scanscherm dicht: camera uit
function endScan() {
  if (!scan) return;
  stopCamera(scan.stream);
  scan = null;
}

async function startScanCamera(s) {
  try {
    const stream = await startCamera(s.video);
    if (scan !== s) return stopCamera(stream);
    s.stream = stream;
  } catch (err) {
    if (scan !== s) return;
    s.camError = err.name === "NotAllowedError" ? "Stashdex mag de camera niet gebruiken. Geef toestemming in je browser, of kies een foto."
      : ["NotFoundError", "OverconstrainedError"].includes(err.name) ? "Geen camera gevonden. Kies een foto."
        : `De camera start niet (${err.message}). Kies een foto.`;
  }
  renderScan(s.stage === "camera");
}

// Tekent het scanscherm opnieuw; focus = de hoofdknop van deze stap de focus geven
function renderScan(focus = false) {
  const s = scan;
  if (!s) return;
  const parts = s.stage === "busy" ? scanBusy() : s.stage === "result" ? [scanScope(), ...scanResult()] : [scanScope(), ...scanCamera()];
  s.body.replaceChildren(...[...parts, scanSession()].filter(Boolean));
  if (s.stage === "camera" && s.stream) s.video.play().catch(() => {});
  if (focus) s.body.querySelector("[data-focus]")?.focus();
}

// Keuze Deze set | Alle sets; bij Deze set ook welke set
function scanScope() {
  const s = scan;
  const sets = S.series.flatMap((g) => g.sets.map((x) => ({ value: x.id, label: x.name })));
  return el("div", { class: "scan-scope" },
    segmented("Zoeken in", s.scope, [{ value: "set", label: "Deze set" }, { value: "all", label: "Alle sets" }], (v) => { s.scope = v; rerankScan(); }),
    s.scope === "set" ? select("Set", s.setId, sets, (v) => { s.setId = v; rerankScan(); }) : null);
}

// Andere set of Alle sets gekozen: bij een uitslag opnieuw zoeken met de al gelezen tekst (niet opnieuw scannen)
function rerankScan() {
  if (scan.stage === "result" && scan.read) rankScan().catch((err) => toast(`Zoeken mislukt: ${err.message}`));
  else renderScan();
}

function scanCamera() {
  const s = scan;
  const file = el("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) scanFile(f);
  } });
  const view = s.camError
    ? el("div", { class: "scan-view scan-view-off" }, el("p", {}, s.camError))
    : el("div", { class: "scan-view" }, s.video, s.frame, el("p", { class: "scan-hint" }, s.stream ? "Houd de kaart recht binnen het kader" : "Camera starten…"));
  return [view,
    el("div", { class: "scan-actions" },
      s.camError ? null : el("button", { type: "button", class: "kk-btn kk-btn-primary scan-shoot", "data-focus": "", disabled: !s.stream, onclick: scanShot }, icon(ICONS.scan, 20), "Scan"),
      el("button", { type: "button", class: "kk-btn kk-btn-ghost", "data-focus": s.camError ? "" : null, onclick: () => file.click() }, "Foto kiezen"),
      file)];
}

function scanBusy() {
  const s = scan;
  return [el("div", { class: "scanbusy", role: "status" },
    el("div", { class: "scanframe" }, el("img", { src: s.photo, alt: "Jouw foto" }), el("i", { class: "scanline" })),
    el("b", {}, "Kaart herkennen…"),
    ocrReady() ? null : el("span", {}, "De eerste keer wordt het leesprogramma geladen, dat duurt even."))];
}

// Foto uit het camerabeeld (alleen het stuk binnen het kader)
function scanShot() {
  const canvas = grabFrame(scan.video, scan.frame);
  if (!canvas) return toast("De camera is nog niet klaar");
  recognize(canvas, false);
}

async function scanFile(file) {
  let canvas;
  try { canvas = await fileToCanvas(file); } catch { return toast("Deze foto kan niet geopend worden"); }
  recognize(canvas, true);
}

// Tekst lezen en de kaart zoeken; bij een gekozen foto zonder zekere uitslag ook de hele foto lezen
async function recognize(canvas, isFile) {
  const s = scan;
  if (!s) return;
  s.stage = "busy";
  s.photo = thumbOf(canvas);
  renderScan();
  try {
    s.read = await readCard(canvas);
    if (scan !== s) return;
    await rankScan(false);
    if (isFile && scan === s && !s.result.sure) {
      const all = await readWhole(canvas);
      if (scan !== s) return;
      s.read = { name: s.read.name + "\n" + all, number: s.read.number + "\n" + all };
      await rankScan(false);
    }
    if (scan === s) { s.stage = "result"; renderScan(true); }
  } catch (err) {
    if (scan !== s) return;
    s.stage = "camera";
    renderScan(true);
    toast(`Herkennen mislukt: ${err.message}`);
  }
}

// Kaarten op volgorde zetten; de beste en 3 alternatieven krijgen hun volledige gegevens (plaatje, prijs, reverse holo)
async function rankScan(show = true) {
  const s = scan;
  const pool = await loadScanPool();
  if (scan !== s) return;
  const { list, sure } = rankCards(s.scope === "set" ? pool.filter((c) => c.set === s.setId) : pool, s.read);
  const top = list.slice(0, 4).map((x) => x.card);
  await Promise.all([...new Set(top.map((c) => c.set))].map((id) => loadCards(id)));
  if (scan !== s) return;
  s.result = { sure, cards: top.map((c) => S.cardById[c.id]).filter(Boolean) };
  s.pick = s.result.cards[0] || null;
  s.variant = "normal";
  if (show) { s.stage = "result"; renderScan(true); }
}

// Waar een kaart vandaan komt: set · nummer
const scanWhere = (c) => `${S.setById[parentIdOf(c.setId)]?.name || ""} · ${numTxt(c)}`;

function scanResult() {
  const s = scan, r = s.result, c = s.pick;
  const out = [];
  if (!c) {
    out.push(el("div", { class: "kk-empty scan-none" }, el("b", {}, "Niet herkend"),
      "Probeer het opnieuw met meer licht en zonder schittering, of zoek de kaart hieronder zelf."));
  } else {
    const first = c === r.cards[0];
    const have = countOf(c.rev && s.variant === "reverse" ? revOf(c) : c);
    out.push(el("p", { class: "scan-verdict" }, first && r.sure ? "Dit is volgens mij…" : first ? "Ik weet het niet zeker. Is het deze?" : "Is het deze?"),
      el("div", { class: "scan-compare" },
        el("figure", {}, el("div", { class: "scanframe" }, el("img", { src: s.photo, alt: "Jouw foto" })), el("figcaption", { class: "flabel" }, "Jouw foto")),
        el("figure", {}, el("div", { class: "scanframe" }, cardImg(c, { lazy: false })), el("figcaption", { class: "flabel" }, "In Stashdex"))),
      el("div", { class: "scan-card" },
        el("b", { class: "found-name" }, c.name),
        el("span", { class: "scan-where" }, scanWhere(c)),
        el("span", { class: "scan-facts" }, chip(c.rarity), el("span", { class: "mono scan-val" }, money(valueEur(c.rev && s.variant === "reverse" ? revOf(c) : c)) ?? "—"),
          have ? el("span", { class: "scan-have" }, `Je hebt er al ${have}`) : null)),
      c.rev ? el("div", { class: "modal-variant" },
        segmented("Versie", s.variant, Object.entries(VARIANT_LABEL).map(([value, label]) => ({ value, label })), (v) => { s.variant = v; renderScan(); })) : null,
      el("div", { class: "scan-actions" },
        el("button", { type: "button", class: "kk-btn kk-btn-primary scan-shoot", "data-focus": "", disabled: s.saving, onclick: confirmScan }, "Ja, voeg toe"),
        el("button", { type: "button", class: "kk-btn kk-btn-ghost", disabled: s.saving, onclick: retryScan }, "Opnieuw")));
  }
  const alts = r.cards.filter((x) => x !== c);
  if (alts.length) {
    out.push(el("div", { class: "alts" }, el("span", { class: "flabel" }, "Of is het een van deze?"),
      alts.map((a) => el("button", { type: "button", class: "alt", onclick: () => pickScan(a) },
        el("span", { class: "alt-art" }, cardImg(a)),
        el("span", { class: "alt-info" }, el("b", {}, a.name), el("span", {}, scanWhere(a))),
        chip(a.rarity)))));
  }
  out.push(scanSearch());
  if (!c) out.push(el("div", { class: "scan-actions" }, el("button", { type: "button", class: "kk-btn kk-btn-primary scan-shoot", "data-focus": "", onclick: retryScan }, "Opnieuw scannen")));
  return out;
}

// Zelf zoeken op naam of nummer, binnen de gekozen set of in alle sets
function scanSearch() {
  const hits = el("div", { class: "scan-hits" });
  const input = el("input", { type: "search", class: "kk-input", placeholder: "Niet goed? Zoek op naam of nummer", "aria-label": "Zelf zoeken op naam of nummer", autocomplete: "off",
    oninput: async (e) => {
      const q = e.target.value, s = scan;
      const pool = await loadScanPool().catch(() => []);
      if (scan !== s || input.value !== q) return;
      const list = searchCards(s.scope === "set" ? pool.filter((c) => c.set === s.setId) : pool, q);
      hits.replaceChildren(...list.map((c) => el("button", { type: "button", class: "scan-hit", onclick: async () => {
        await loadCards(c.set);
        if (scan === s && S.cardById[c.id]) pickScan(S.cardById[c.id]);
      } }, el("b", {}, c.name), el("span", {}, `${S.setById[c.set]?.name || ""} · #${c.number}`))),
      q.trim() && !list.length ? el("p", { class: "scan-nohit" }, "Niets gevonden" + (s.scope === "set" ? " in deze set. Probeer Alle sets." : ".")) : null);
    } });
  return el("div", { class: "scan-search" }, input, hits);
}

function pickScan(card) {
  scan.pick = card;
  scan.variant = "normal";
  renderScan(true);
  scan.body.parentElement.scrollTop = 0; // terug naar boven, naar de gekozen kaart
}

function retryScan() {
  scan.stage = "camera";
  scan.photo = scan.read = scan.result = scan.pick = null;
  renderScan(true);
}

// Kaart toevoegen (aantal + 1) en meteen door naar de volgende kaart
async function confirmScan() {
  const s = scan, c = s.pick, variant = c.rev ? s.variant : "normal";
  const key = ownedKey(c.id, variant), before = S.owned[key]?.count || 0;
  s.saving = true;
  renderScan();
  const error = await storeCount(c.id, variant, before + 1);
  s.saving = false;
  render();
  if (error) {
    renderScan(true);
    return toast(`Opslaan mislukt: ${error.message}`);
  }
  const label = c.name + (variant === "reverse" ? " (reverse holo)" : "");
  s.added.push({ id: c.id, variant, label });
  toast(`${label} toegevoegd` + (before ? ` (nu ${before + 1}×)` : ""));
  if (scan === s) retryScan();
}

// Een toegevoegde kaart weer weghalen (aantal − 1)
async function undoScan(item, btn) {
  const s = scan, key = ownedKey(item.id, item.variant);
  btn.disabled = true;
  const error = await storeCount(item.id, item.variant, Math.max(0, (S.owned[key]?.count || 0) - 1));
  render();
  if (error) {
    btn.disabled = false;
    return toast(`Ongedaan maken mislukt: ${error.message}`);
  }
  if (scan === s) {
    s.added = s.added.filter((x) => x !== item);
    renderScan();
  }
  toast(`${item.label} weer weggehaald`);
}

// Teller en lijstje van wat je in deze scanronde hebt toegevoegd, met ongedaan maken
function scanSession() {
  const s = scan, n = s.added.length;
  if (!n) return null;
  return el("details", { class: "scan-session", open: s.sessionOpen, ontoggle: (e) => { s.sessionOpen = e.currentTarget.open; } },
    el("summary", {}, el("b", {}, `${n} ${n === 1 ? "kaart" : "kaarten"} toegevoegd`), el("span", {}, "bekijk")),
    el("ul", {}, [...s.added].reverse().map((item) => el("li", {}, el("span", {}, item.label),
      el("button", { type: "button", class: "linkbtn", "aria-label": `${item.label} ongedaan maken`, onclick: (e) => undoScan(item, e.currentTarget) }, "Ongedaan maken")))));
}

// ---------- Meldingen en kaart-kanteling ----------
let toastTimer;
function toast(message) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const t = el("div", { class: "toast", role: "status" }, message);
  document.body.append(t);
  toastTimer = setTimeout(() => t.remove(), 2800);
}
window.addEventListener("stashdex-toast", (e) => toast(e.detail));

document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeMore(); } });

// Kaarten kantelen naar de muis toe, met een holo-glans die meebeweegt
const TILT = ".kk-card:not(.kk-card-missing), .kk-modal-art";
document.addEventListener("pointermove", (e) => {
  const card = e.target.closest?.(TILT);
  // Instelling "Holo en kantelen": Uit = niet kantelen, Rustig = maximaal 2°
  const motion = document.documentElement.dataset.motion;
  if (!card || e.pointerType === "touch" || motion === "off") return;
  const r = card.getBoundingClientRect(), max = motion === "calm" ? 4 : card.classList.contains("kk-modal-art") ? 12 : 10;
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  card.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
  card.style.setProperty("--my", (y * 100).toFixed(1) + "%");
  card.style.setProperty("--ry", ((x - 0.5) * max).toFixed(2) + "deg");
  card.style.setProperty("--rx", ((0.5 - y) * max).toFixed(2) + "deg");
});
document.addEventListener("pointerout", (e) => {
  const card = e.target.closest?.(TILT);
  if (!card || card.contains(e.relatedTarget)) return;
  for (const [k, v] of [["--rx", "0deg"], ["--ry", "0deg"], ["--mx", "50%"], ["--my", "50%"]]) card.style.setProperty(k, v);
});

// ---------- Inloggen / uitloggen ----------
const $ = (id) => document.getElementById(id);

async function enter(session) {
  if (S.userId === session.user.id) return; // al open (bv. na het verversen van de sessie)
  S.userId = session.user.id;
  S.email = session.user.email || "";
  buildShell();
  render();
  await Promise.all([loadSets(), loadOwned(), loadRate(), loadSettings(), loadWishCount()]);
  if (S.userId !== session.user.id) return; // intussen uitgelogd
  // De set uit de instellingen kan van een ander apparaat komen; controleren dat hij bestaat
  if (S.setId !== ALL && S.sets.length) {
    S.setId = parentIdOf(S.setId);
    if (!S.setById[S.setId]) S.setId = S.series[0]?.sets[0]?.id;
  }
  // Kaarten met een id die niet (meer) bij een set hoort (bv. oude pokemontcg-id's) niet meetellen
  if (S.sets.length) for (const key of Object.keys(S.owned)) if (!S.setById[setIdOf(splitKey(key)[0])]) delete S.owned[key];
  render();
  loadCards(S.setId);
  // Ook de sets van je kaarten ophalen, voor de kaartwaaier in de header en "Alle kaarten"
  loadOwnedSets();
}

function leave() {
  S.userId = null;
  S.owned = {};
  S.ownedLoaded = false;
  S.ownedError = null;
  S.wishCount = null;
  S.settingsLoaded = false;
  clearTimeout(syncTimer);
  closeModal();
  ui.main = null;
  $("home").replaceChildren();
  $("home").classList.remove("head-hidden");
}

startAuth({ onEnter: enter, onLeave: leave });
