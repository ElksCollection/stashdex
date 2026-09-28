// Zeldzaamheidsladder en types uit het ontwerpsysteem (acht niveaus, laag → hoog)
const TIERS = [
  { code: "C", sym: "◯", tone: "c", holo: 0.06, name: "Common" },
  { code: "U", sym: "◇", tone: "u", holo: 0.12, name: "Uncommon" },
  { code: "R", sym: "★", tone: "r", holo: 0.25, name: "Rare" },
  { code: "RR", sym: "★★", tone: "rr", holo: 0.45, name: "Double Rare" },
  { code: "IR", sym: "✦", tone: "ir", holo: 0.65, name: "Illustration Rare" },
  { code: "SIR", sym: "✦✦", tone: "sir", holo: 0.8, name: "Special Illustration Rare" },
  { code: "UR", sym: "✪", tone: "ur", holo: 0.9, name: "Ultra Rare", band: "gold" },
  { code: "FUR", sym: "◈", tone: "fur", holo: 1, name: "Futuristic Rare", band: "neon" },
];

// Elke zeldzaamheid uit de kaartdata op de ladder: [niveau, eigen code, eigen holo-sterkte]
const ALIAS = {
  "Common": [0], "Uncommon": [1],
  "Rare": [2], "Rare Holo": [2, null, 0.3], "Holo Rare": [2, null, 0.3], "Pikachu Rare": [2], "Amazing Rare": [2], "Rare BREAK": [2],
  "Rare Prime": [2], "Rare Prism Star": [2], "Rare ACE": [2], "Classic Collection": [2],
  "Double Rare": [3], "Rare Holo ex": [3], "Rare Holo EX": [3], "Rare Holo GX": [3], "Rare Holo LV.X": [3],
  "Rare Holo V": [3], "Rare Holo VMAX": [3], "Rare Holo VSTAR": [3],
  "Holo Rare V": [3], "Holo Rare VMAX": [3], "Holo Rare VSTAR": [3],
  "Radiant Rare": [3], "ACE SPEC Rare": [3], "Shiny Rare": [3], "Rare Shiny": [3], "MEGA_ATTACK_RARE": [3],
  "Mega Attack Rare": [3], "Shiny Rare V": [3], "Shiny Rare VMAX": [3],
  "Illustration Rare": [4], "Art Rare": [4], "Trainer Gallery Rare Holo": [4],
  "Special Illustration Rare": [5], "Special Art Rare": [5],
  "Ultra Rare": [6], "Rare Ultra": [6], "LEGEND": [6], "Shiny Ultra Rare": [6], "Rare Shiny GX": [6],
  "Rare Holo Star": [6], "Rare Shining": [6], "Full Art Trainer": [6], "RGB Rare": [6, "RGB"],
  "Hyper Rare": [6, "HR"], "Rare Secret": [6, "HR"], "Rare Rainbow": [6, "HR"], "Secret Rare": [6, "HR"], "Mega Hyper Rare": [6, "HR"],
  "Black White Rare": [6, "HR"],
  "Futuristic Rare": [7],
};

// Opzoeken zonder op hoofdletters te letten: de bron schrijft bv. "Double rare" én "Double Rare"
const LOOKUP = Object.fromEntries(Object.entries(ALIAS).map(([k, v]) => [k.toLowerCase(), v]));

// Gegevens van één zeldzaamheid, of null als hij (nog) niet op de ladder staat (bv. "Promo")
export function tier(rarity) {
  const a = rarity ? LOOKUP[rarity.toLowerCase()] : null;
  if (!a) return null;
  const t = TIERS[a[0]];
  return { rank: a[0] + 1, code: a[1] || t.code, sym: t.sym, tone: t.tone, holo: a[2] ?? t.holo, band: t.band || null };
}
export const rarityRank = (r) => tier(r)?.rank || 0;
export const holoLevel = (r) => tier(r)?.holo ?? 0.35;
export const TIER_NAMES = TIERS.map((t) => t.name);

// Type van een kaart: Pokémon-type, of Trainer/Energy
export function typeName(card) {
  if (card.supertype === "Trainer") return "Trainer";
  if (card.supertype === "Energy") return "Energy";
  return card.types?.[0] || "Colorless";
}
// CSS-klasse voor de kleur; Energy gebruikt dezelfde leikleur als Trainer
export const typeKey = (card) => {
  const t = typeName(card);
  return t === "Energy" ? "trainer" : t.toLowerCase();
};
export const TYPES = ["Fire", "Water", "Grass", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Dragon", "Colorless", "Fairy", "Trainer", "Energy"];
