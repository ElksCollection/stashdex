// Stashdex: de app na het inloggen (stap 1: nieuwe indeling + collectie)
import { supabase, safe } from "./supabase-client.js";
import { startAuth } from "./auth.js";
import { tier, rarityRank, holoLevel, typeName, typeKey, TYPES } from "./rarity.js";

const EUR_PER_USD = 0.87; // vaste koers van 22-09-2026; prijzen in de data zijn in dollars (TCGPlayer)
const PAGE = 20; // aantal kaarten per "Toon meer"
// Subsets die bij een hoofdset horen, en de letters voor hun kaartnummers (als die alleen cijfers zijn)
const SUBSET_NAME = /^(.+?):? (Classic Collection|Trainer Gallery|Galarian Gallery|Shiny Vault)$/;
const PART_CODES = { "Classic Collection": "CC" };

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
  stats: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
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
  cardById: {},                       // alle geladen kaarten op kaart-id (voor de kaartwaaier)
  owned: {}, ownedLoaded: false, ownedError: null, // per kaart-id: { count, raw_value_usd }
  nav: "collection",
  setId: pref.get("set", "me55"),
  view: pref.get("view", "cards"),
  sort: pref.get("sort", "number"),
  cur: pref.get("cur", "EUR"),
  open: pref.get("open", {}),
  q: "", filterOpen: false, own: "all", typeF: "all", shown: PAGE,
};

const setIdOf = (cardId) => cardId.slice(0, cardId.indexOf("-"));
const parentIdOf = (setId) => S.parentOf[setId] || setId;
const countOf = (cardId) => S.owned[cardId]?.count || 0;
// Eigen waarde gaat voor; anders de marktprijs uit de nachtelijke data
const valueUsd = (card) => S.owned[card.id]?.raw_value_usd ?? card.usd ?? null;
// Totaal van een hoofdset inclusief zijn subsets
const setTotal = (set) => S.cards[set.id]?.length || (S.subsets[set.id] || []).reduce((n, s) => n + (s.total || 0), set.total || 0);
// Kaartnummer; Classic Collection krijgt "CC" ervoor, zodat #004 en #CC004 niet door elkaar lopen
const numTxt = (card) => {
  const n = /^\d+$/.test(card.number) ? card.number.padStart(3, "0") : card.number;
  return "#" + (card.partCode && /^\d/.test(n) ? card.partCode : "") + n;
};

function money(usd) {
  if (usd == null) return null;
  const n = S.cur === "EUR" ? usd * EUR_PER_USD : usd;
  const big = n >= 1000;
  const digits = big ? 0 : 2;
  return (S.cur === "EUR" ? "€" : "$") + " " + n.toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Aantal verschillende kaarten in bezit, per set
function ownedBySet() {
  const out = {};
  for (const id of Object.keys(S.owned)) {
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

    // Subsets horen bij hun hoofdset, herkend aan de naam: "<hoofdset>[:] Classic Collection" enz.
    const byName = new Map(sets.map((s) => [s.series + "|" + s.name, s]));
    S.parentOf = {};
    S.subsets = {};
    for (const s of sets) {
      const m = s.name.match(SUBSET_NAME);
      const parent = m && byName.get(s.series + "|" + m[1]);
      if (!parent) continue;
      s.part = m[2];
      S.parentOf[s.id] = parent.id;
      (S.subsets[parent.id] ||= []).push(s);
    }

    const bySeries = new Map();
    for (const s of sets.filter((x) => !S.parentOf[x.id])) {
      if (!bySeries.has(s.series)) bySeries.set(s.series, []);
      bySeries.get(s.series).push(s);
    }
    S.sets = sets;
    S.setById = Object.fromEntries(sets.map((s) => [s.id, s]));
    S.series = [...bySeries].map(([name, list]) => ({ name, sets: list }));
    S.setId = parentIdOf(S.setId);
    if (!S.setById[S.setId]) S.setId = S.series[0]?.sets[0]?.id;
  } catch (err) {
    S.setsError = `De lijst met sets kon niet geladen worden (${err.message}).`;
  }
}

// Kaarten van een set ophalen; een set die al onderweg is wordt niet dubbel opgehaald
const loading = {};
function loadCards(setId) {
  if (!setId || S.cards[setId]) return Promise.resolve();
  return (loading[setId] ||= fetchCards(setId).finally(() => {
    delete loading[setId];
    render();
  }));
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
        .select("card_id,count,raw_value_usd").order("card_id").range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    S.owned = Object.fromEntries(rows.map((r) => [r.card_id, { count: r.count, raw_value_usd: r.raw_value_usd }]));
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

// Zet een kopje vóór de eerste kaart van elke subset; alleen bij sorteren op nummer, anders lopen ze door elkaar
function withHeadings(cards, heading, node) {
  const out = [];
  let prev = null;
  for (const c of cards) {
    if (S.sort === "number" && c.part && c.part !== prev) out.push(heading(c.part));
    prev = c.part;
    out.push(node(c));
  }
  return out;
}

// Kaarttegel: plaatje, type, naam, zeldzaamheid en Nr · Aantal · Waarde
// foil = glans altijd aan (topkaart), anders alleen vanaf Illustration Rare
function cardTile(card, { foil = false } = {}) {
  const n = countOf(card.id), t = tier(card.rarity), missing = !n;
  const cls = ["kk-card", "kk-type-" + typeKey(card), t?.band && "kk-holo-" + t.band, !missing && (foil || (t && t.rank >= 5)) && "kk-card-foil", missing && "kk-card-missing"].filter(Boolean).join(" ");
  return el("button", { type: "button", class: cls, style: `--kk-holo-max:${holoLevel(card.rarity)}`, "aria-label": card.name + (missing ? " (nog niet in bezit, klik om toe te voegen)" : ""), onclick: () => openModal(card) },
    el("div", { class: "kk-card-art" }, el("img", { src: card.img, alt: "", loading: "lazy" })),
    el("span", { class: "kk-type-tag" }, typeName(card)),
    missing ? el("span", { class: "kk-missing-tag" }, "Nog niet") : null,
    el("div", { class: "kk-card-info" },
      el("div", { class: "kk-card-name", title: card.name }, card.name),
      el("div", { class: "kk-card-rar" }, chip(card.rarity)),
      el("div", { class: "kk-card-facts" },
        fact("Nr", numTxt(card)), fact("Aantal", n ? n + "×" : null), fact("Waarde", n ? money(valueUsd(card)) : null, "kk-fact-value"))));
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
  const railBtn = (key, label) => (ui.rail[key] = el("button", { type: "button", class: "rail-btn", onclick: () => go(key) }, icon(ICONS[key]), el("span", {}, label)));
  const rail = el("nav", { class: "rail", "aria-label": "Hoofdmenu" },
    el("button", { type: "button", class: "mark-btn", "aria-label": "Intro opnieuw afspelen", onclick: () => toast("De intro komt in stap 4") }, logo(52)),
    el("button", { type: "button", class: "scan-btn", "aria-label": "Kaart scannen", onclick: () => toast("Scannen komt in stap 5") }, icon(ICONS.scan, 24), el("span", {}, "Scan")),
    el("span", { class: "rail-sep" }),
    railBtn("home", "Start"), railBtn("collection", "Collectie"), railBtn("wish", "Wensen"), railBtn("stats", "Statistiek"),
    el("span", { class: "rail-spacer" }),
    el("button", { type: "button", class: "rail-btn", onclick: () => supabase.auth.signOut() }, icon(ICONS.logout), el("span", {}, "Uitloggen")));

  // Setpaneel: zoeken, sets per serie, "+ Editie toevoegen"
  ui.search = el("input", { type: "search", class: "kk-input", placeholder: "Zoek een set of kaart…", "aria-label": "Zoek een set of kaart", autocomplete: "off",
    oninput: (e) => { S.q = e.target.value; S.shown = PAGE; render(); } });
  ui.series = el("nav", { class: "kk-sidebar", "aria-label": "Sets" });
  const panel = el("aside", { class: "setpanel", "aria-label": "Sets" },
    el("div", { class: "setpanel-search" }, ui.search),
    el("div", { class: "setpanel-list scroll" }, ui.series),
    el("div", { class: "setpanel-foot" },
      el("button", { type: "button", class: "kk-btn kk-btn-ghost kk-btn-block", onclick: () => toast("Editie toevoegen komt in stap 6") }, "+ Editie toevoegen")));

  ui.main = el("main", { class: "main scroll" });
  $("home").replaceChildren(hero, el("div", { class: "layout" }, rail, panel, ui.main));
}

function render() {
  if (!ui.main || !S.userId) return;
  const bySet = ownedBySet();
  const setsWith = Object.keys(bySet).length, ownedCards = Object.keys(S.owned).length;
  ui.heroSub.textContent = `${setsWith} ${setsWith === 1 ? "set" : "sets"} · ${ownedCards} kaarten`;
  ui.cur.replaceChildren(segmented("Valuta", S.cur, [{ value: "USD", label: "$" }, { value: "EUR", label: "€" }], (v) => {
    S.cur = v; pref.set("cur", v); render();
  }));
  for (const [key, btn] of Object.entries(ui.rail)) btn.classList.toggle("on", S.nav === key);
  renderFan();
  renderSeries(bySet);
  ui.main.replaceChildren(...renderMain(bySet));
}

// Kaartwaaier: de 6 waardevolste kaarten uit de collectie (1–3 links, 4–6 rechts)
function renderFan() {
  const top = Object.keys(S.owned).map((id) => S.cardById[id]).filter(Boolean)
    .sort((a, b) => (valueUsd(b) ?? -1) - (valueUsd(a) ?? -1)).slice(0, 6);
  // Alleen opnieuw opbouwen als de kaarten veranderd zijn, zodat de waaier niet knippert
  const key = top.map((c) => c.id).join(",");
  if (key === ui.fanKey) return;
  ui.fanKey = key;
  const fanCard = (c, i) => {
    const label = `${c.name} · ${S.setById[parentIdOf(c.setId)]?.name || ""}`;
    return el("button", { type: "button", class: `fan-card f${i} kk-type-${typeKey(c)}`, title: label, "aria-label": label, onclick: () => openModal(c) },
      el("img", { src: c.img, alt: "" }));
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

  ui.series.replaceChildren(...groups.flatMap(({ g, sets, open }) => [
    el("button", { type: "button", class: "series" + (open ? "" : " closed"), "aria-expanded": String(open), onclick: () => {
      S.open[g.name] = !open; pref.set("open", S.open); render();
    } }, icon(ICONS.chevron, 16), el("span", {}, g.name), el("small", {}, `${g.sets.length} ${g.sets.length === 1 ? "set" : "sets"}`)),
    ...(open ? sets.map((s) => navItem(s, bySet[s.id] || 0)) : []),
  ]));
  if (!groups.length) {
    ui.series.append(el("p", { class: "setpanel-empty" }, S.sets.length ? `Geen set gevonden voor "${S.q}".` : "Sets laden…"));
  }
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
  wish: ["Wensenlijst", "Nog niet gebouwd", "De wensenlijst komt in stap 3, samen met het vernieuwde kaartdetail."],
  stats: ["Statistiek", "Je hele collectie in cijfers", "Statistiek komt in stap 2."],
};

function renderMain(bySet) {
  const out = [];
  if (S.ownedError) out.push(emptyState("Er ging iets mis", S.ownedError));
  if (S.nav !== "collection") {
    const [title, sub, text] = LATER[S.nav];
    return [...out, pageTitle(title, sub), emptyState("Komt eraan", text)];
  }
  if (S.setsError) return [...out, emptyState("Er ging iets mis", S.setsError)];
  const set = S.setById[S.setId];
  if (!set) return [...out, el("p", { class: "loading" }, "Sets laden…")];

  const total = setTotal(set);
  const parts = (S.subsets[set.id] || []).map((s) => s.part);
  const cards = S.cards[set.id];

  // Kop van de set: titel + voortgang links, rechts de topkaart (zeldzaamste in bezit, dan hoogste waarde)
  const feat = (cards || []).filter((c) => countOf(c.id))
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || (valueUsd(b) ?? -1) - (valueUsd(a) ?? -1))[0];
  out.push(el("div", { class: "sethead" + (feat ? "" : " sethead-solo") },
    el("div", { class: "sethead-main" },
      pageTitle(set.name, `${set.series} · ${total} kaarten` + (parts.length ? ` · incl. ${parts.join(", ")}` : "")),
      setProgress(set.name, bySet[set.id] || 0, total)),
    feat ? el("div", { class: "feat" },
      el("span", { class: "feat-badge" }, "Topkaart van deze set"),
      el("div", { class: "feat-card" }, cardTile(feat, { foil: true }))) : null));

  if (!cards) {
    out.push(S.cardsError[set.id] ? emptyState("Er ging iets mis", S.cardsError[set.id]) : el("p", { class: "loading" }, "Kaarten laden…"));
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
  const setMatches = q && set.name.toLowerCase().includes(q);
  let list = cards.filter((c) => {
    const n = countOf(c.id);
    if (q && !setMatches && !c.name.toLowerCase().includes(q)) return false;
    if (S.own === "have" && !n) return false;
    if (S.own === "need" && n) return false;
    if (S.typeF !== "all" && typeName(c) !== S.typeF) return false;
    return true;
  });
  const byValue = (c) => valueUsd(c) ?? -1;
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
      segmented("Bezit", S.own, [{ value: "all", label: "Alles" }, { value: "have", label: "In bezit" }, { value: "need", label: "Nog niet" }], (v) => {
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
        const n = countOf(c.id);
        return el("button", { type: "button", class: "lrow" + (n ? "" : " lmiss"), onclick: () => openModal(c) },
          el("span", { class: "mono" }, numTxt(c)), el("span", { class: "lname" }, c.name),
          el("span", { class: "col-type" }, el("i", { class: `tdot kk-type-${typeKey(c)}` }), typeName(c)),
          el("span", { class: "col-rar" }, chip(c.rarity)),
          el("span", { class: "mono" }, n ? n + "×" : "—"),
          el("span", { class: "mono lval" }, money(valueUsd(c)) ?? "—"));
      })));
  } else if (S.view === "grid") {
    out.push(el("div", { class: "raster" }, withHeadings(shown, partTitle, (c) =>
      el("button", { type: "button", class: `thumb kk-type-${typeKey(c)}` + (countOf(c.id) ? "" : " tmiss"), "aria-label": c.name, title: c.name, onclick: () => openModal(c) },
        el("img", { src: c.img, alt: "", loading: "lazy" }), el("span", { class: "mono" }, numTxt(c))))));
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

function openModal(card) {
  closeModal();
  const set = S.setById[parentIdOf(setIdOf(card.id))];
  const where = card.part ? `${set?.name || ""} · ${card.part} · ${numTxt(card)}` : `${set?.name || ""} · #${card.number}/${set?.printedTotal || set?.total || "?"}`;
  const have = countOf(card.id);
  let count = Math.max(1, have);
  const t = tier(card.rarity);
  const countEl = el("b", { class: "mono" }, count);
  const setCount = (n) => { count = n; countEl.textContent = n; };

  const actions = el("div", { class: "kk-full modal-actions" });
  const setBusy = (on) => actions.querySelectorAll("button").forEach((b) => (b.disabled = on));

  async function save() {
    setBusy(true);
    const { error } = await supabase.from("collection")
      .upsert({ user_id: S.userId, card_id: card.id, count, updated_at: new Date().toISOString() }, { onConflict: "user_id,card_id" });
    setBusy(false);
    if (error) return toast(`Opslaan mislukt: ${error.message}`);
    S.owned[card.id] = { raw_value_usd: null, ...S.owned[card.id], count };
    closeModal();
    render();
    toast(have ? `${card.name} opgeslagen` : `${card.name} staat nu in je collectie`);
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase.from("collection").delete().eq("user_id", S.userId).eq("card_id", card.id);
    setBusy(false);
    if (error) return toast(`Verwijderen mislukt: ${error.message}`);
    delete S.owned[card.id];
    closeModal();
    render();
    toast(`${card.name} is uit je collectie gehaald`);
  }

  actions.append(
    el("button", { type: "button", class: "kk-btn kk-btn-primary", onclick: save }, have ? "Opslaan" : "Toevoegen aan collectie"),
    have ? el("button", { type: "button", class: "kk-btn kk-btn-danger", onclick: remove }, "Verwijderen") : null);

  const closeBtn = el("button", { type: "button", class: "kk-modal-close", "aria-label": "Sluiten", onclick: closeModal }, "×");
  const scrim = el("div", { class: "kk-scrim", onclick: (e) => { if (e.target === scrim) closeModal(); } },
    el("div", { class: "kk-modal", role: "dialog", "aria-modal": "true", "aria-label": card.name },
      closeBtn,
      el("div", { class: "kk-modal-art" + (t?.band ? " kk-holo-" + t.band : ""), style: `--kk-holo-max:${card.rarity ? holoLevel(card.rarity) : 0.55}` },
        el("img", { src: card.imgLarge || card.img, alt: card.name })),
      el("h2", {}, card.name),
      el("div", { class: "kk-modal-sub" }, `${where} · ${card.rarity || "—"}`),
      el("div", { class: "kk-fieldgrid" },
        el("div", { class: "kk-full stepper-wrap" },
          el("span", { class: "flabel" }, "Aantal"),
          el("div", { class: "stepper" },
            el("button", { type: "button", "aria-label": "Eén minder", onclick: () => setCount(Math.max(1, count - 1)) }, "−"),
            countEl,
            el("button", { type: "button", "aria-label": "Eén meer", onclick: () => setCount(count + 1) }, "+")),
          el("span", { class: "flabel", style: "margin-left:auto" }, "Waarde"),
          el("b", { class: "mono", style: "color:var(--red)" }, money(valueUsd(card)) ?? "—")),
        actions)));

  modal = { scrim, returnFocus: document.activeElement };
  document.body.append(scrim);
  closeBtn.focus();
}

function closeModal() {
  if (!modal) return;
  modal.scrim.remove();
  const back = modal.returnFocus;
  modal = null;
  if (back?.isConnected) back.focus();
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

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

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
  await Promise.all([loadSets(), loadOwned()]);
  if (S.userId !== session.user.id) return; // intussen uitgelogd
  render();
  loadCards(S.setId);
  // Ook de sets van je kaarten ophalen, voor de kaartwaaier in de header
  const ownedSets = new Set(Object.keys(S.owned).map((id) => parentIdOf(setIdOf(id))));
  ownedSets.forEach((id) => { if (S.setById[id]) loadCards(id); });
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
