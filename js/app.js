// Stashdex: de app na het inloggen (stap 1: nieuwe indeling + collectie)
import { supabase, safe } from "./supabase-client.js";
import { startAuth } from "./auth.js";
import { tier, rarityRank, holoLevel, typeName, typeKey, TYPES } from "./rarity.js";

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
  owned: {}, ownedLoaded: false, ownedError: null, // per kaart-id: { count }
  rate: { eurUsd: FALLBACK_EUR_USD, date: null },  // 1 euro = eurUsd dollar; date = dag van de ECB-koers
  nav: "collection",
  setId: pref.get("set", "30th"),
  view: pref.get("view", "cards"),
  sort: pref.get("sort", "number"),
  cur: pref.get("cur", "EUR"),
  period: pref.get("period", "1M"),
  topBy: pref.get("topBy", "rarity"),  // top 4 van de set: op zeldzaamheid (dan waarde) of alleen op waarde
  open: pref.get("open", {}),
  q: "", filterOpen: false, own: "all", typeF: "all", shown: PAGE,
};

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
  // Slanke holo-header: kaartwaaier · logo + naam · kaartwaaier, valuta rechts
  ui.heroSub = el("span", { class: "slim-sub" });
  ui.cur = el("div", { class: "slim-cur" });
  ui.fanLeft = el("div", { class: "fan fan-left", "aria-label": "Uitgelicht uit je collectie" });
  ui.fanRight = el("div", { class: "fan fan-right", "aria-label": "Uitgelicht uit je collectie" });
  ui.fanKey = null;
  const hero = el("header", { class: "slimbar kk-hero" },
    ui.fanLeft,
    el("div", { class: "slim-brand" }, logo(40, "slim-logo"), el("h1", { class: "slim-title" }, "Stashdex"), ui.heroSub),
    ui.fanRight,
    ui.cur);

  // Menubalk: logo, Scan, Start · Collectie · Wensen · Statistiek, Uitloggen
  ui.rail = {};
  const railBtn = (key, label, extra = "") => (ui.rail[key] = el("button", { type: "button", class: `rail-btn ${extra}`.trim(), "data-nav": key, onclick: () => go(key) }, icon(ICONS[key]), el("span", {}, label)));
  const rail = el("nav", { class: "rail", "aria-label": "Hoofdmenu" },
    el("button", { type: "button", class: "mark-btn", "aria-label": "Intro opnieuw afspelen", onclick: () => toast("De intro komt in stap 4") }, logo(52)),
    el("button", { type: "button", class: "scan-btn", "aria-label": "Kaart scannen", onclick: () => toast("Scannen komt in stap 5") }, icon(ICONS.scan, 24), el("span", {}, "Scan")),
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
  ui.panel = panel;
  ui.layout = el("div", { class: "layout" }, rail, panel, ui.main);
  $("home").replaceChildren(hero, ui.layout);
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
  ui.cur.replaceChildren(segmented("Valuta", S.cur, [{ value: "USD", label: "$" }, { value: "EUR", label: "€" }], (v) => {
    S.cur = v; pref.set("cur", v); render();
  }), ...(S.cur === "USD" && S.rate.date
    ? [el("span", { class: "rate-note" }, "Koers van " + new Date(S.rate.date + "T12:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" }))]
    : []));
  for (const [key, btn] of Object.entries(ui.rail)) btn.classList.toggle("on", S.nav === key);
  renderFan();
  renderSeries(bySet);
  ui.main.replaceChildren(...renderMain(bySet));
}

// Kaartwaaier: de 6 waardevolste kaarten uit de collectie (1–3 links, 4–6 rechts)
function renderFan() {
  // Elke versie telt als eigen kaart, dus een dure reverse holo kan er ook in
  const top = Object.keys(S.owned).map(entryOf).filter(Boolean)
    .sort((a, b) => (valueEur(b) ?? -1) - (valueEur(a) ?? -1)).slice(0, 6);
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
  home: ["Welkom terug", "Start", "Het startscherm met je tegels, \"Bezig met\" en je waardevolste kaarten komt in stap 2."],
  binders: ["Binders", "Je eigen binders, net als in het echt", "Hier maak je straks je eigen binders met sleeves of toploaders en kies je een kaft. Binders komen in stap 7."],
  wish: ["Wensenlijst", "Nog niet gebouwd", "De wensenlijst komt in stap 3, samen met het vernieuwde kaartdetail."],
  stats: ["Statistiek", "Je hele collectie in cijfers", "Statistiek komt in stap 2."],
};

// ---------- Instellingen: voorlopig alleen de back-up van je collectie ----------
function renderSettings() {
  return [pageTitle("Instellingen", "Stashdex naar jouw smaak"),
    el("section", { class: "settings-box" },
      el("h3", {}, "Back-up van je collectie"),
      el("p", {}, "Download al je kaarten als bestand (CSV). Je kunt het openen in Excel of Google Spreadsheets en bewaren als extra back-up."),
      el("button", { type: "button", class: "kk-btn kk-btn-primary", onclick: downloadCollection }, "Download mijn collectie (CSV)")),
    emptyState("Komt eraan", "Meer instellingen, bijvoorbeeld of een kaart in meerdere binders tegelijk mag, komen later.")];
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
  const byRarity = (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity);
  const byWorth = (a, b) => (valueEur(b) ?? -1) - (valueEur(a) ?? -1);
  const ranked = (cards || []).filter((c) => countOf(c))
    .sort((a, b) => (S.topBy === "value" ? byWorth(a, b) || byRarity(a, b) : byRarity(a, b) || byWorth(a, b)) || a.i - b.i);
  const feat = ranked[0], podium = ranked.slice(1, 4);
  out.push(el("div", { class: "sethead" + (feat ? "" : " sethead-solo") },
    el("div", { class: "sethead-main" },
      all ? pageTitle("Alle kaarten", "Je hele collectie · alle sets")
        : pageTitle(set.name, `${set.series} · ${total} kaarten` + (parts.length ? ` · incl. ${parts.join(", ")}` : "")),
      all ? collectionSummary(cards) : setProgress(set.name, bySet[set.id] || 0, total),
      feat ? el("div", { class: "podium-head" },
        el("span", { class: "podium-label" }, "Top 4 op"),
        segmented("Top 4 op", S.topBy, [{ value: "rarity", label: "Zeldzaamheid" }, { value: "value", label: "Waarde" }], (v) => {
          S.topBy = v; pref.set("topBy", v); render();
        })) : null,
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
    tabs(S.view, [{ value: "cards", label: "Kaarten" }, { value: "list", label: "Lijst" }, { value: "grid", label: "Raster" }], (v) => {
      S.view = v; pref.set("view", v); render();
    }),
    el("div", { class: "toolbar-gap" }),
    select("Sorteer op", S.sort, [
      { value: "number", label: "Nummer" }, { value: "name", label: "Alfabet (A-Z)" }, { value: "value", label: "Waarde (hoog → laag)" },
      { value: "rarity", label: "Zeldzaamheid" }, { value: "type", label: "Type" },
    ], (v) => { S.sort = v; pref.set("sort", v); render(); }),
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
    if (S.typeF !== "all" && typeName(c) !== S.typeF) return false;
    return true;
  });
  const byValue = (c) => valueEur(c) ?? -1;
  const sorters = {
    number: (a, b) => a.i - b.i,
    name: (a, b) => a.name.localeCompare(b.name) || a.i - b.i,
    value: (a, b) => byValue(b) - byValue(a) || a.i - b.i,
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
  if (nav === "collection") loadCards(S.setId);
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
  S.setId = id;
  S.shown = PAGE;
  pref.set("set", id);
  render();
  ui.main.scrollTop = 0;
  loadCards(id);
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
    const { error } = await supabase.from("collection")
      .upsert({ user_id: S.userId, card_id: card.id, variant, count, updated_at: new Date().toISOString() }, { onConflict: "user_id,card_id,variant" });
    setBusy(false);
    if (error) return toast(`Opslaan mislukt: ${error.message}`);
    const key = ownedKey(card.id, variant);
    S.owned[key] = { ...S.owned[key], count };
    closeModal();
    render();
    toast(have ? `${label} opgeslagen` : `${label} staat nu in je collectie`);
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase.from("collection").delete().eq("user_id", S.userId).eq("card_id", card.id).eq("variant", variant);
    setBusy(false);
    if (error) return toast(`Verwijderen mislukt: ${error.message}`);
    delete S.owned[ownedKey(card.id, variant)];
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
          S.period = v; pref.set("period", v); draw();
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
  const back = modal.returnFocus;
  modal = null;
  if (restore && back?.isConnected) back.focus();
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
  if (!card || e.pointerType === "touch") return;
  const r = card.getBoundingClientRect(), max = card.classList.contains("kk-modal-art") ? 12 : 10;
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
  buildShell();
  render();
  await Promise.all([loadSets(), loadOwned(), loadRate()]);
  if (S.userId !== session.user.id) return; // intussen uitgelogd
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
  closeModal();
  ui.main = null;
  $("home").replaceChildren();
}

startAuth({ onEnter: enter, onLeave: leave });
