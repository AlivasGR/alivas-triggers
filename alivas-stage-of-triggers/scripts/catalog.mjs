/**
 * Catalog of animation / sound "families" built from Sequencer database paths,
 * with lexical search and context-based recommendations. No dependencies, no LLMs.
 * @module catalog
 */

/**
 * @typedef {object} Variant
 * @property {string} path    Playable Sequencer path (stops above distance keys).
 * @property {string|null} color
 * @property {string} label
 */

/**
 * @typedef {object} Family
 * @property {string} id
 * @property {"jb2a"|"psfx"} library
 * @property {string} name
 * @property {string} category
 * @property {"projectile"|"melee"|"onToken"|"impact"|"area"|"aura"|"marker"|"sound"} kind
 * @property {"circle"|"cone"|"line"|"square"|null} shape
 * @property {boolean} persistent
 * @property {string[]} colors
 * @property {Variant[]} variants
 * @property {string[]} tags
 * @property {string} text
 * @property {string} sample   A leaf path whose file can be previewed.
 */

/* -------------------------------------------- */
/*  Vocabularies                                */
/* -------------------------------------------- */

/** Base colour words; combined colours ("greenyellow", "dark_bluewhite") are built from these. */
const COLOR_BASE = ["blue", "red", "green", "purple", "orange", "yellow", "pink", "white", "black", "grey", "gray",
  "teal", "brown", "silver", "gold", "cyan", "tan"];
const COLOR_WORD = COLOR_BASE.slice().sort((a, b) => b.length - a.length).join("|");
const COLOR_RE = new RegExp(`^(?:(?:dark|bright|light)_?)?(?:${COLOR_WORD})(?:_?(?:${COLOR_WORD}))*(?:\\d+|_no_circle|_with_circle)?$|^(?:multicolored|rainbow)\\d*$`);
const COLOR_PART_RE = new RegExp(COLOR_WORD, "g");

const DIST_RE = /^\d+ft$/;
const FILE_INDEX_RE = /^(0|[1-9]\d*)$/;      // ".0", ".3": flattened file indexes
const DESIGN_NUM_RE = /^(\d+|v\d+)$/i;       // "01", "001", "v1": design indexes
const STOP = new Set(["of", "the", "and", "from", "a", "an", "to", "in", "with", "for", "on", "at", "or"]);
const SMALL = new Set(["of", "the", "and", "from", "a", "an", "to", "in", "on", "at", "or", "vs"]);

/**
 * Curated relations. Each entry: `words` are related terms (as they appear in paths), `colors` are preferred
 * colour words in order of preference. Words are matched against path tokens, so prefer path vocabulary.
 */
const RAW = {
  // Damage types
  acid: { words: ["acid", "corrosion", "corrode", "caustic", "slime", "ooze", "goo", "splash", "melt", "vitriol", "chromatic"], colors: ["green", "dark_green", "yellow"] },
  bludgeoning: { words: ["bludgeoning", "blunt", "crush", "smash", "slam", "hammer", "maul", "club", "greatclub", "mace", "warhammer", "quarterstaff", "fist", "unarmed", "boulder", "rock", "rocks", "stone"], colors: ["grey", "white", "brown"] },
  cold: { words: ["cold", "frost", "ice", "icy", "freeze", "frozen", "snow", "sleet", "chill", "blizzard", "icicle", "winter", "snowflake", "frigid", "glacial"], colors: ["blue", "white", "teal", "bluewhite"] },
  fire: { words: ["fire", "flame", "flames", "flaming", "burn", "burning", "scorch", "scorching", "searing", "inferno", "ember", "blaze", "bonfire", "campfire", "fireball", "firework", "brazier", "braziers", "lava", "magma", "molten", "ignite", "torch", "heat", "pyre"], colors: ["orange", "red", "yellow", "orangeyellow", "redyellow"] },
  force: { words: ["force", "magic_missile", "missile", "eldritch", "arcane", "spiritual", "kinetic", "telekinesis", "energy", "arcane_hand", "unseen", "mystic"], colors: ["purple", "blue", "pink", "bluepurple"] },
  lightning: { words: ["lightning", "electric", "electricity", "shock", "shocking", "spark", "arc", "static", "storm", "jolt", "zap", "thunderbolt", "chain_lightning", "voltaic"], colors: ["yellow", "blue", "white", "bluewhite"] },
  necrotic: { words: ["necrotic", "death", "dead", "decay", "rot", "skull", "bone", "grave", "soul", "wither", "withering", "necromancy", "toll", "tolling", "shadow", "drain", "vampiric", "undead", "doom", "grim", "bell", "curse", "dark", "arms_of_hadar"], colors: ["dark_purple", "dark_green", "purple", "green", "black"] },
  piercing: { words: ["piercing", "pierce", "stab", "arrow", "arrows", "spear", "dagger", "javelin", "dart", "thrust", "rapier", "fang", "bite", "spike", "spikes", "bullet", "shortsword", "kunai", "shuriken"], colors: ["grey", "white", "brown"] },
  poison: { words: ["poison", "poisoned", "venom", "venomous", "toxic", "toxin", "fumes", "noxious", "stinking", "gas", "plague", "vile", "cloud", "fog"], colors: ["green", "dark_green", "purple"] },
  psychic: { words: ["psychic", "mind", "mental", "telepathy", "brain", "dissonant", "thought", "dream", "sliver", "confusion", "madness", "eyes", "whispers"], colors: ["purple", "pink", "blue", "pinkpurple"] },
  radiant: { words: ["radiant", "holy", "divine", "sacred", "celestial", "sun", "solar", "smite", "guiding", "angelic", "heaven", "glow", "sunbeam", "daylight", "halo", "light", "spirit", "sanctified"], colors: ["yellow", "white", "orange", "yellowwhite"] },
  slashing: { words: ["slashing", "slash", "cut", "slice", "sword", "swords", "axe", "greataxe", "handaxe", "scimitar", "claw", "claws", "rend", "blade", "glaive", "halberd", "falchion", "longsword", "greatsword"], colors: ["grey", "white", "red"] },
  thunder: { words: ["thunder", "thunderclap", "thunderwave", "thunderous", "sound", "soundwave", "shockwave", "boom", "sonic", "wave", "clap", "concussive", "shatter", "resonance", "roar", "bang", "drum"], colors: ["white", "blue", "grey"] },
  healing: { words: ["healing", "heal", "cure", "cure_wounds", "healing_generic", "restore", "restoration", "regeneration", "mend", "mending", "recovery", "life", "vitality", "rejuvenate", "revive", "renew", "mercy"], colors: ["green", "pink", "white", "yellow"] },

  // Schools (abbreviations are generated from the full names below)
  abjuration: { words: ["abjuration", "ward", "wards", "shield", "protection", "protect", "barrier", "dispel", "counterspell", "antimagic", "sanctuary", "aegis", "armor", "armour", "defense", "defence", "resistance"], colors: ["blue", "white", "yellow"] },
  conjuration: { words: ["conjuration", "summon", "summoning", "conjure", "portal", "portals", "teleport", "misty_step", "gate", "spiritual", "spectral", "elemental", "creature"], colors: ["purple", "blue", "yellow"] },
  divination: { words: ["divination", "detect", "scry", "scrying", "sense", "eyes", "eye", "insight", "awareness", "augury", "vision", "reveal", "locate"], colors: ["white", "blue", "yellow"] },
  enchantment: { words: ["enchantment", "charm", "charmed", "hearts", "heart", "domination", "hypnotic", "suggestion", "sleep", "command", "enthrall", "bless", "bardic_inspiration"], colors: ["pink", "purple", "red"] },
  evocation: { words: ["evocation", "blast", "explosion", "burst", "ball", "bolt", "ray", "beam", "fireball", "wave", "energy"], colors: ["orange", "blue", "yellow"] },
  illusion: { words: ["illusion", "invisible", "invisibility", "mirror", "image", "phantasm", "disguise", "glamour", "phantom", "shimmer", "mirage"], colors: ["purple", "blue", "pink"] },
  necromancy: { words: ["necromancy", "undead", "death", "dead", "drain", "skull", "bone", "grave", "soul", "curse", "necrotic", "toll"], colors: ["dark_purple", "dark_green", "green"] },
  transmutation: { words: ["transmutation", "transform", "transmute", "polymorph", "enlarge", "reduce", "shapechange", "haste", "slow", "stone", "growth", "plant_growth", "alter", "change"], colors: ["green", "yellow", "orange"] },

  // Conditions
  blinded: { words: ["blinded", "blind", "darkness", "dark", "eyes", "sightless", "blindness"], colors: ["dark_purple", "black", "grey"] },
  charmed: { words: ["charmed", "charm", "hearts", "heart", "love", "enchantment", "enthrall", "fascinate", "domination"], colors: ["pink", "red", "purple"] },
  deafened: { words: ["deafened", "deaf", "mute", "silence", "sound", "muffled", "ear", "deafness"], colors: ["grey", "purple", "white"] },
  exhaustion: { words: ["exhaustion", "exhausted", "tired", "fatigue", "weary", "slow", "drained", "weak", "sweat", "drop"], colors: ["grey", "dark_purple", "blue"] },
  frightened: { words: ["frightened", "fear", "scared", "terror", "dread", "horror", "fright", "afraid", "panic", "scare", "scream", "skull"], colors: ["dark_purple", "dark_red", "purple", "dark_orange"] },
  grappled: { words: ["grappled", "grapple", "grab", "hold", "entangle", "vine", "vines", "chain", "tentacles", "bind", "web", "seized", "grasp"], colors: ["green", "grey", "brown"] },
  incapacitated: { words: ["incapacitated", "stun", "stunned", "dizzy", "daze", "dazed", "helpless", "stars"], colors: ["yellow", "white", "grey"] },
  invisible: { words: ["invisible", "invisibility", "vanish", "hidden", "hide", "cloak", "fade", "shimmer", "ghost", "stealth", "sneak", "refraction"], colors: ["blue", "white", "grey"] },
  paralyzed: { words: ["paralyzed", "paralysis", "paralyze", "hold", "freeze", "frozen", "immobile", "lock", "stuck"], colors: ["yellow", "blue", "white"] },
  petrified: { words: ["petrified", "petrify", "stone", "statue", "medusa", "rock", "gaze", "granite"], colors: ["grey", "brown", "white"] },
  poisoned: { words: ["poisoned", "poison", "venom", "toxic", "sick", "nausea", "drop", "fumes"], colors: ["green", "dark_green", "purple"] },
  prone: { words: ["prone", "fall", "fallen", "knocked", "trip", "knockdown", "sprawled", "footprints", "tumble"], colors: ["grey", "brown", "white"] },
  restrained: { words: ["restrained", "bound", "bind", "web", "entangle", "chain", "chains", "net", "rope", "vine", "vines", "root", "roots", "snare"], colors: ["green", "grey", "brown"] },
  stunned: { words: ["stunned", "stun", "dizzy", "dizzy_stars", "stars", "daze", "dazed", "shock", "wobble"], colors: ["yellow", "white", "blue"] },
  unconscious: { words: ["unconscious", "sleep", "asleep", "zzz", "snore", "slumber", "knocked", "coma", "symbol", "dead", "down"], colors: ["dark_purple", "blue", "dark_pink", "purple"] },

  // Generic words
  heal: { words: ["heal", "cure", "healing", "healing_generic", "cure_wounds", "restore", "mend", "life"], colors: ["green", "pink", "white", "yellow"] },
  cure: { words: ["cure", "heal", "healing", "healing_generic", "cure_wounds", "restore"], colors: ["green", "pink", "white"] },
  healing_generic: { words: ["heal", "cure", "healing", "cure_wounds"], colors: ["green", "pink", "white"] },
  shield: { words: ["shield", "ward", "barrier", "protection", "guard", "defense", "aegis", "bubble", "armor", "shield_themed"], colors: ["blue", "white", "yellow"] },
  ward: { words: ["ward", "shield", "barrier", "protection", "guard", "rune", "wards"], colors: ["blue", "white", "purple"] },
  barrier: { words: ["barrier", "shield", "ward", "wall", "bubble", "energy_wall", "protection"], colors: ["blue", "white", "purple"] },
  armor: { words: ["armor", "armour", "shield", "ward", "barrier", "protection", "stoneskin", "skin", "natural", "bark"], colors: ["grey", "brown", "green", "white"] },
  protection: { words: ["protection", "protect", "shield", "ward", "barrier", "abjuration", "sanctuary", "guard", "evil", "good"], colors: ["blue", "white", "yellow"] },
  teleport: { words: ["teleport", "misty_step", "portal", "portals", "blink", "vanish", "warp", "jump", "step", "dimension_door"], colors: ["blue", "purple", "white"] },
  misty_step: { words: ["misty_step", "teleport", "portal", "step", "mist", "blink"], colors: ["blue", "purple", "white"] },
  portal: { words: ["portal", "portals", "teleport", "gate", "misty_step", "vortex", "door", "rift"], colors: ["purple", "blue", "green"] },
  smite: { words: ["smite", "divine_smite", "strike", "impact", "burst", "searing", "thunderous", "wrathful", "branding", "blinding"], colors: ["yellow", "white", "orange"] },
  divine_smite: { words: ["smite", "divine_smite", "divine", "radiant", "holy"], colors: ["yellow", "white", "orange"] },
  curse: { words: ["curse", "hex", "bane", "doom", "malediction", "mark", "condition", "cursed"], colors: ["dark_purple", "purple", "dark_red", "green"] },
  hex: { words: ["hex", "curse", "bane", "mark", "hunters_mark", "condition"], colors: ["dark_purple", "purple", "dark_red"] },
  mark: { words: ["mark", "hunters_mark", "marker", "markers", "target", "hex", "brand", "sigil"], colors: ["red", "green", "purple"] },
  bless: { words: ["bless", "buff", "boon", "blessing", "bardic_inspiration", "inspiration", "benediction", "favor", "on_token_buff", "condition"], colors: ["yellow", "white", "blue", "green"] },
  buff: { words: ["buff", "bless", "boon", "enhance", "empower", "on_token_buff", "inspiration", "strength", "condition"], colors: ["yellow", "blue", "green", "white"] },
  boon: { words: ["boon", "bless", "buff", "blessing", "gift", "condition", "on_token_buff"], colors: ["yellow", "blue", "green"] },
  rage: { words: ["rage", "fury", "wrath", "anger", "berserk", "frenzy", "enrage", "furious", "flames", "energy_strands"], colors: ["red", "dark_red", "orange", "redyellow"] },
  fury: { words: ["fury", "rage", "wrath", "anger", "berserk", "frenzy"], colors: ["red", "dark_red", "orange"] },
  fear: { words: ["fear", "frightened", "scared", "terror", "horror", "dread", "scare", "skull"], colors: ["dark_purple", "dark_red", "purple", "dark_orange"] },
  sleep: { words: ["sleep", "unconscious", "slumber", "asleep", "zzz", "dream", "symbol"], colors: ["dark_purple", "blue", "dark_pink"] },
  nature: { words: ["nature", "plant", "plants", "vine", "vines", "leaves", "leaf", "swirling_leaves", "flowers", "flower", "petals", "bloom", "butterflies", "fairies", "fireflies", "druid", "growth", "wood", "forest", "entangle", "thorns"], colors: ["green", "greenyellow", "yellow", "pink"] },
  flowers: { words: ["flowers", "flower", "petals", "bloom", "blossom", "butterflies", "fairies", "nature", "leaves", "swirling_leaves", "vine", "plant"], colors: ["pink", "green", "yellow", "greenyellow", "white"] },
  summon: { words: ["summon", "summoning", "conjure", "conjuration", "portal", "portals", "spirit", "spectral", "spiritual_weapon", "magic_signs", "circle"], colors: ["purple", "blue", "green"] },
  weapon: { words: ["weapon", "sword", "axe", "dagger", "swoosh", "swooshes", "melee", "attack", "spiritual_weapon"], colors: ["grey", "white"] },
  greataxe: { words: ["greataxe", "axe", "heavy", "swoosh", "swooshes", "weapon", "slash", "handaxe", "melee", "greatsword", "maul"], colors: ["grey", "white"] },
  swoosh: { words: ["swoosh", "swooshes", "weapon", "melee", "whoosh", "swing", "heavy", "light"], colors: [] },
  explosion: { words: ["explosion", "explode", "blast", "burst", "boom", "detonate", "impact", "fireball", "shatter", "bomb"], colors: ["orange", "red", "yellow"] },
  light: { words: ["light", "glow", "lantern", "torch", "dancing_light", "dancing", "lights", "sun", "daylight", "beam"], colors: ["yellow", "white", "orange"] },
  darkness: { words: ["darkness", "dark", "shadow", "gloom", "night", "black", "void", "umbral"], colors: ["dark_purple", "black", "dark_blue"] },
  wind: { words: ["wind", "gust", "air", "breeze", "tornado", "whirlwind", "storm", "wind_stream", "wind_lines", "wind_wall"], colors: ["white", "blue", "grey"] },
  water: { words: ["water", "splash", "liquid", "wave", "rain", "aqua", "bubble", "flood", "ocean", "bubbles"], colors: ["blue", "teal", "white"] },
  earth: { words: ["earth", "rock", "rocks", "boulder", "stone", "ground", "cracks", "quake", "earthquake", "sandstone", "dirt"], colors: ["brown", "grey", "orange"] },
  music: { words: ["music", "song", "note", "notes", "bardic", "bardic_inspiration", "lute", "instrument", "melody", "music_notations", "music_note"], colors: ["yellow", "pink", "white"] },
  spirit: { words: ["spirit", "spirits", "ghost", "spectral", "spirit_guardians", "ancestral", "soul", "astral"], colors: ["white", "blue", "purple"] },
  bite: { words: ["bite", "fang", "fangs", "maw", "teeth", "claws", "melee", "creature", "beast"], colors: ["red", "grey", "green"] },
  sound: { words: ["sound", "soundwave", "thunder", "bell", "music", "sonic", "noise", "echo", "ring"], colors: ["white", "blue"] },
  chain: { words: ["chain", "chains", "bind", "grapple", "restrained", "link"], colors: ["grey", "white"] },
  arrow: { words: ["arrow", "arrows", "bow", "longbow", "ranged", "projectile", "shot", "volley", "quiver"], colors: ["grey", "brown", "white"] },
  bolt: { words: ["bolt", "ray", "beam", "missile", "projectile", "shot", "lightning"], colors: [] },
  beam: { words: ["beam", "ray", "laser", "bolt", "energy_beam", "disintegrate"], colors: [] },
  ray: { words: ["ray", "beam", "bolt", "scorching_ray", "ray_of_frost"], colors: [] },
  orb: { words: ["orb", "sphere", "ball", "globe"], colors: [] },
  thorns: { words: ["thorns", "thorn", "spikes", "spike", "vine", "plant", "brambles"], colors: ["green", "brown"] }
};

/** Tight equivalence groups; every member lists the others as related words. */
const ALIASES = [
  ["heal", "cure", "healing", "healing_generic", "cure_wounds", "regeneration"],
  ["shield", "ward", "barrier"],
  ["teleport", "misty_step", "portal", "blink"],
  ["smite", "divine_smite"],
  ["curse", "hex"],
  ["bless", "buff", "boon"],
  ["rage", "fury"],
  ["fear", "frightened", "horror"],
  ["stunned", "dizzy"], ["charmed", "hearts"], ["invisible", "invisibility"], ["paralyzed", "paralysis"],
  ["sleep", "unconscious"], ["flowers", "petals", "bloom"]
];

/**
 * Curated synonym map: key -> { words: related path words, colors: preferred colours (best first) }.
 * Covers dnd5e damage types, schools (abbreviation and full name), conditions and generic spell words.
 * @type {Record<string, {words: string[], colors: string[]}>}
 */
export const SYNONYMS = (() => {
  const out = {};
  for ( const [k, v] of Object.entries(RAW) ) out[k] = { words: [...new Set(v.words)], colors: [...v.colors] };
  const abbr = { abj: "abjuration", con: "conjuration", div: "divination", enc: "enchantment", evo: "evocation", ill: "illusion", nec: "necromancy", trs: "transmutation" };
  for ( const [a, full] of Object.entries(abbr) ) out[a] = { words: [full, ...out[full].words.filter(w => w !== full)], colors: [...out[full].colors] };
  for ( const group of ALIASES ) {
    for ( const w of group ) {
      out[w] ??= { words: [], colors: [] };
      for ( const o of group ) if ( o !== w && !out[w].words.includes(o) ) out[w].words.push(o);
    }
  }
  return out;
})();

/** word -> keys whose word list contains it (reverse lookup). */
const REVERSE = new Map();
for ( const [k, v] of Object.entries(SYNONYMS) ) {
  for ( const w of v.words ) {
    if ( !REVERSE.has(w) ) REVERSE.set(w, []);
    REVERSE.get(w).push(k);
  }
}

/** Expand a word into related words with weights (the word itself is not included). */
function expandWord(word) {
  const out = new Map();
  const direct = SYNONYMS[word];
  if ( direct ) for ( const w of direct.words ) out.set(w, 0.8);
  for ( const k of REVERSE.get(word) ?? [] ) if ( !out.has(k) ) out.set(k, 0.55);
  out.delete(word);
  // Compound words ("misty_step") never match a single path token; their parts do
  for ( const [w, wt] of [...out] ) {
    if ( !w.includes("_") ) continue;
    for ( const part of w.split("_") ) if ( part.length >= 3 && !STOP.has(part) && !out.has(part) ) out.set(part, wt * 0.6);
  }
  return out;
}

/** Context hints per activity type. */
const ACTIVITY_WORDS = {
  heal: ["heal", "healing", "cure"],
  enchant: ["buff", "bless", "boon"],
  summon: ["summon", "portal"]
};

/** Kinds that read as "the same thing" for kind fit. Value is the partial credit (30 = exact). */
const KIND_FIT = {
  aura: { onToken: 20, marker: 10, area: 10 },
  onToken: { aura: 20, marker: 14, impact: 12 },
  impact: { onToken: 12, area: 10, projectile: 5 },
  projectile: { impact: 6, melee: 2 },
  area: { aura: 8, impact: 8 },
  melee: { impact: 6, onToken: 3 },
  marker: { onToken: 12, aura: 10 },
  sound: {}
};

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const tok = s => String(s ?? "").toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
const compact = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** True if a and b differ by at most one insertion, deletion, substitution or adjacent swap. */
function edit1(a, b) {
  if ( a === b ) return true;
  const la = a.length, lb = b.length;
  if ( Math.abs(la - lb) > 1 ) return false;
  let i = 0;
  while ( i < la && i < lb && a[i] === b[i] ) i++;
  if ( i === la || i === lb ) return true;
  if ( la === lb ) {
    if ( a.slice(i + 1) === b.slice(i + 1) ) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function titleWord(w, first) {
  if ( /[A-Z]/.test(w) ) return w;
  if ( !first && SMALL.has(w) ) return w;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function pretty(seg) {
  const words = String(seg).split(/[_\-\s]+/).filter(Boolean);
  return words.map((w, i) => titleWord(w, i === 0)).join(" ");
}

function normColor(raw) {
  const m = raw.replace(/\d+$/, "").match(/^((?:dark|bright|light)_)?(.*)$/);
  return ((m[1] ?? "") + m[2].replace(/_/g, "")) || raw;
}

/** Base colour words inside a colour key ("dark_orangepurple" -> ["orange", "purple"]). */
function colorParts(c) {
  const rest = c.replace(/^(dark|bright|light)_?/, "");
  return rest.match(COLOR_PART_RE) ?? [rest];
}

function colorLabel(c) {
  const dark = c.match(/^(dark|bright|light)_/)?.[1];
  const parts = colorParts(c).map(p => p.charAt(0).toUpperCase() + p.slice(1));
  return (dark ? `${dark.charAt(0).toUpperCase()}${dark.slice(1)} ` : "") + parts.join(" / ");
}

/* -------------------------------------------- */
/*  Parsing                                     */
/* -------------------------------------------- */

const PSFX_ROLE = /^(intro|outro|loop|complete|caster|target|cast|primary|secondary|beam|explosion|single|sequence|generic|only|intro-fade|outro-fade|persist-complete|fade-complete|with-cast)$/;

/** Strip trailing file indexes and a distance key. Returns true if a distance key was present. */
function stripTail(segs) {
  while ( segs.length > 1 && FILE_INDEX_RE.test(segs.at(-1)) ) segs.pop();
  let dist = false;
  if ( segs.length > 1 && DIST_RE.test(segs.at(-1)) ) { segs.pop(); dist = true; }
  while ( segs.length > 1 && FILE_INDEX_RE.test(segs.at(-1)) ) segs.pop();
  return dist;
}

function parseJB2A(path) {
  const s = path.split(".").slice(1);
  if ( s.length < 2 ) return null;
  const dist = stripTail(s);
  let ci = -1;
  for ( let i = s.length - 1; i >= 1; i-- ) if ( COLOR_RE.test(s[i]) ) { ci = i; break; }
  let end = s.length;
  while ( end > 2 && /^\d+$/.test(s[end - 1]) ) end--;
  if ( ci >= end ) ci = -1;
  const stem = s.slice(0, end);
  const color = ci >= 0 ? normColor(s[ci]) : null;
  const idSegs = stem.filter((x, i) => i !== ci);
  while ( idSegs.length > 2 && /^\d+$/.test(idSegs.at(-1)) ) idSegs.pop();
  // Only the first numeric segment is a design; later ones are sequence indexes and fold into the family
  let seen = false;
  const dropped = [];
  const ids = idSegs.filter((x, i) => {
    if ( i < 1 || !/^\d+$/.test(x) ) return true;
    if ( !seen ) { seen = true; return true; }
    dropped.push(x);
    return false;
  });
  return { idSegs: ids, stem: `jb2a.${stem.join(".")}`, color, dist, label: dropped.join(" ") };
}

function parsePSFX(path) {
  const s = path.split(".").slice(1);
  if ( s.length < 2 ) return null;
  const dist = stripTail(s);
  const idSegs = s.slice();
  while ( idSegs.length > 2 && (/^\d+$/.test(idSegs.at(-1)) || /^group\d+$/.test(idSegs.at(-1)) || PSFX_ROLE.test(idSegs.at(-1))) ) idSegs.pop();
  return { idSegs, stem: `psfx.${s.join(".")}`, color: null, dist, label: s.slice(idSegs.length).join(" ") };
}

/* -------------------------------------------- */
/*  Classification                              */
/* -------------------------------------------- */

const MARKER_CAT = new Set(["markers", "markers_scifi", "icon", "condition", "token_border", "token_stage", "ui"]);
const MELEE_CAT = new Set(["melee_attack", "melee_generic", "unarmed_strike", "bite", "claws", "flurry_of_blows", "sneak_attack", "shield_attack"]);
const AREA_RE = /^(template|zoning|ambient_fog|fog|energy_wall|wall|grease|plant_growth|spike_trap|ground_cracks|scorched_earth|black_tentacles|web$|caltrops|darkness|moonbeam|entangle|burning_hands|cone_of_cold|breath_weapons|volley|sleet_storm|cloud_of_daggers|lava_spout|fire_trap|wind_wall|gust_of_wind|cone$)/;
const AURA_RE = /(^aura|aura_themed|guardians|energy_field|bubble|themed|orbit|swirling|fireflies|butterflies|fairies)/;
const IMPACT_TOK = new Set(["impact", "explosion", "burst", "eruption", "shatter", "splash", "shockwave", "thunderwave", "firework", "blast", "hit"]);
const PROJ_TOK = new Set(["bolt", "ray", "beam", "arrow", "missile", "throw", "projectile", "shot", "boomerang", "dart", "javelin", "bullet"]);

function classify(lib, segs, dist) {
  const toks = new Set(segs.flatMap(tok));
  let shape = null;
  if ( toks.has("cone") ) shape = "cone";
  else if ( toks.has("line") || toks.has("wall") ) shape = "line";
  else if ( toks.has("square") || toks.has("rect") ) shape = "square";
  else if ( ["circle", "ring", "round", "sphere", "radius", "aura"].some(t => toks.has(t)) ) shape = "circle";
  if ( lib === "psfx" ) return { kind: "sound", shape };
  const cat = segs[0];
  let kind;
  if ( segs.includes("aura") ) kind = "aura";
  else if ( MARKER_CAT.has(cat) ) kind = "marker";
  else if ( segs.some(s => AREA_RE.test(s)) ) kind = "area";
  else if ( dist ) kind = "projectile";
  else if ( MELEE_CAT.has(cat) || segs.includes("melee") ) kind = "melee";
  else if ( [...toks].some(t => IMPACT_TOK.has(t)) ) kind = "impact";
  else if ( [...toks].some(t => PROJ_TOK.has(t)) ) kind = "projectile";
  else if ( segs.some(s => AURA_RE.test(s)) ) kind = "aura";
  else kind = "onToken";
  if ( !shape ) shape = kind === "projectile" ? "line" : ((kind === "aura" || kind === "impact") ? "circle" : null);
  return { kind, shape };
}

/* -------------------------------------------- */
/*  Naming                                      */
/* -------------------------------------------- */

/** "Melee Attack 03 · Greataxe", "Template Circle · Aura 01 · Complete Small". */
function buildName(lib, idSegs, meta) {
  let segs = idSegs.slice();
  if ( lib === "psfx" && segs.length > 2 && /^(cantrips|\d+(st|nd|rd|th)-level-spells|class-features)$/.test(segs[0]) ) segs = segs.slice(1);
  const groups = [];
  let open = false;
  segs.forEach((seg, i) => {
    const isNum = DESIGN_NUM_RE.test(seg);
    let text = isNum ? seg.toUpperCase() : pretty(seg);
    if ( i === 0 ) {
      if ( meta && compact(meta) === compact(seg) ) text = meta.trim();
      groups.push([text]);
      open = false;
    } else if ( isNum ) {
      groups.at(-1).push(text);
      open = false;
    } else if ( open ) groups.at(-1).push(text);
    else { groups.push([text]); open = true; }
  });
  return groups.map(g => g.join(" ")).join(" · ");
}

/* -------------------------------------------- */
/*  Catalog                                     */
/* -------------------------------------------- */

/**
 * Group Sequencer database paths into families (all colours / indexes / distances of one animation together).
 * @param {string[]} paths  Flat database paths (e.g. `Sequencer.Database.flattenedEntries`).
 * @param {object} [options]
 * @param {(path: string) => (string|undefined)} [options.getName]  JB2A metadata name for a path.
 * @param {(path: string) => (string|undefined)} [options.getFile]  Preview file for a path.
 * @returns {{families: Family[], byId: Map<string, Family>, facets: {library: object, kind: object, category: object, color: object, shape: object}}}
 */
export function buildCatalog(paths, { getName, getFile } = {}) {
  const groups = new Map();
  for ( const path of paths ) {
    if ( typeof path !== "string" ) continue;
    const lib = path.startsWith("jb2a.") ? "jb2a" : (path.startsWith("psfx.") ? "psfx" : null);
    if ( !lib ) continue;
    const p = lib === "jb2a" ? parseJB2A(path) : parsePSFX(path);
    if ( !p ) continue;
    const id = `${lib}.${p.idSegs.join(".")}`;
    let g = groups.get(id);
    if ( !g ) groups.set(id, g = { id, lib, idSegs: p.idSegs, dist: false, vars: new Map(), leaves: new Map() });
    g.dist ||= p.dist;
    const key = p.color ?? p.stem;
    const cur = g.vars.get(key);
    if ( !cur || p.stem.length < cur.stem.length || (p.stem.length === cur.stem.length && p.stem < cur.stem) ) {
      g.vars.set(key, { path: p.stem, color: p.color, label: p.label, stem: p.stem, key });
    }
    // A few leaf candidates per variant for previews; prefer a mid-range distance
    let L = g.leaves.get(key);
    if ( !L ) g.leaves.set(key, L = []);
    if ( /\.30ft/.test(path) ) L.unshift(path);
    else if ( L.length < 5 ) L.push(path);
  }

  const families = [];
  for ( const g of groups.values() ) {
    const vars = [...g.vars.values()];
    vars.sort((a, b) => (a.color ?? "").localeCompare(b.color ?? "") || a.stem.localeCompare(b.stem));
    const firstLeaf = g.leaves.get(vars[0].key)[0];
    let meta;
    if ( g.lib === "jb2a" && getName ) {
      meta = getName(firstLeaf);
      if ( meta === "undefined" ) meta = undefined;
    }
    const name = buildName(g.lib, g.idSegs, meta);
    const persistent = g.idSegs.some(s => /^loop/.test(s)) || vars.some(v => /(^|\.)loop(\.|$)/.test(v.stem));
    const { kind, shape } = classify(g.lib, g.idSegs, g.dist);
    const colors = vars.filter(v => v.color).map(v => v.color);
    const variants = vars.map(v => ({
      path: v.path,
      color: v.color,
      label: v.color ? colorLabel(v.color) : (v.label ? v.label.replace(/\./g, " ") : "Default")
    }));
    let sample = firstLeaf;
    if ( getFile ) {
      outer: for ( const v of vars ) {
        for ( const leaf of g.leaves.get(v.key) ) {
          if ( getFile(leaf) ) { sample = leaf; break outer; }
        }
      }
    }
    const category = pretty(g.idSegs[0]);
    const wordSet = new Set(g.idSegs.flatMap(tok).filter(w => !/^\d/.test(w)));
    const tags = new Set([g.lib, kind, category.toLowerCase()]);
    if ( shape ) tags.add(shape);
    if ( persistent ) { tags.add("loop"); tags.add("persistent"); }
    for ( const c of colors ) { tags.add(c); for ( const part of colorParts(c) ) tags.add(part); }
    for ( const w of wordSet ) {
      tags.add(w);
      let n = 0;
      for ( const rel of expandWord(w).keys() ) if ( n++ < 6 ) tags.add(rel);
    }
    for ( const t of [...tags] ) if ( /^\d/.test(t) ) tags.delete(t);
    families.push({ id: g.id, library: g.lib, name, category, kind, shape, persistent, colors, variants, tags: [...tags], text: "", sample });
  }
  families.sort((a, b) => a.id.localeCompare(b.id));
  for ( const f of families ) f.text = `${f.name} ${f.tags.join(" ")} ${f.id}`.toLowerCase();

  const byId = new Map(families.map(f => [f.id, f]));
  const facets = { library: {}, kind: {}, category: {}, color: {}, shape: {} };
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  for ( const f of families ) {
    bump(facets.library, f.library);
    bump(facets.kind, f.kind);
    bump(facets.category, f.category);
    if ( f.shape ) bump(facets.shape, f.shape);
    for ( const c of f.colors ) bump(facets.color, c);
  }
  const catalog = { families, byId, facets };
  Object.defineProperty(catalog, "_idx", { value: buildIndex(families), enumerable: false });
  return catalog;
}

/* -------------------------------------------- */
/*  Index                                       */
/* -------------------------------------------- */

const W_NAME = 10, W_PATH = 4, W_TAG = 2.5;

function buildIndex(families) {
  const post = new Map();   // token -> Map(famIdx -> weight)
  const info = [];
  const df = new Map();
  const add = (tkn, i, w) => {
    let m = post.get(tkn);
    if ( !m ) post.set(tkn, m = new Map());
    if ( (m.get(i) ?? 0) < w ) m.set(i, w);
  };
  families.forEach((f, i) => {
    const nameToks = tok(f.name);
    const segsC = f.id.split(".").slice(1);
    const pathToks = segsC.flatMap(tok);
    const lit = new Set([...nameToks, ...pathToks].filter(t => !/^\d/.test(t)));
    for ( const t of nameToks ) add(t, i, W_NAME);
    for ( const t of pathToks ) add(t, i, W_PATH);
    for ( const c of f.colors ) { add(c, i, W_PATH); for ( const part of colorParts(c) ) add(part, i, W_PATH); }
    add(f.kind, i, W_PATH);
    add(f.library, i, W_PATH);
    if ( f.shape ) add(f.shape, i, W_PATH);
    tok(f.category).forEach(t => add(t, i, W_PATH));
    if ( f.persistent ) { add("loop", i, W_PATH); add("persistent", i, W_PATH); }
    for ( const t of f.tags ) if ( !f.colors.includes(t) ) for ( const part of tok(t) ) add(part, i, W_TAG);
    for ( const t of lit ) df.set(t, (df.get(t) ?? 0) + 1);
    const core = new Set([compact(f.name.split(" · ")[0].replace(/\s+\d+$/, "")), compact(segsC[0])]);
    if ( segsC.length > 1 ) core.add(compact(segsC.slice(0, 2).join("")));
    if ( f.library === "psfx" ) for ( const sg of segsC ) core.add(compact(sg));
    core.add(compact(f.name.replace(/\s*·\s*/g, " ").replace(/\b\d+\b/g, "")));
    core.delete("");
    const colorSet = new Set(f.colors.flatMap(c => [c, ...colorParts(c)]));
    info.push({ lit, core: [...core], colorSet, nameToks: new Set(nameToks), nameLen: nameToks.length });
  });
  return { post, tokens: [...post.keys()], info, df, N: families.length };
}

/* -------------------------------------------- */
/*  Search                                      */
/* -------------------------------------------- */

function filterOk(f, { library, kind, shape, colors, persistent, category }, ci) {
  if ( library && f.library !== library ) return false;
  if ( kind && f.kind !== kind ) return false;
  if ( shape && f.shape !== shape ) return false;
  if ( persistent !== undefined && persistent !== null && f.persistent !== !!persistent ) return false;
  if ( category && f.category.toLowerCase() !== String(category).toLowerCase() && compact(f.category) !== compact(category) ) return false;
  if ( colors && (!Array.isArray(colors) || colors.length) ) {
    if ( ![].concat(colors).some(c => ci.colorSet.has(c)) ) return false;
  }
  return true;
}

/** Score a query word against the vocabulary: Map(famIdx -> score). */
function matchWord(idx, word) {
  const scores = new Map();
  const typo = word.length >= 5;
  const put = (tkn, mult) => {
    for ( const [i, w] of idx.post.get(tkn) ) {
      const s = w * mult;
      if ( s > (scores.get(i) ?? 0) ) scores.set(i, s);
    }
  };
  for ( const tkn of idx.tokens ) {
    if ( tkn === word ) put(tkn, 1);
    else if ( tkn.startsWith(word) ) put(tkn, 0.8);
    else if ( typo && tkn.length >= 4 && edit1(word, tkn) ) put(tkn, 0.55);
  }
  for ( const [rel, w] of expandWord(word) ) if ( idx.post.has(rel) ) put(rel, 0.45 * w);
  return scores;
}

/**
 * Search the catalog. Every query word must match (AND); words match by prefix, by one typo (5+ letters)
 * and by synonym. Name matches outrank tag and path matches.
 * @param {{families: Family[]}} catalog
 * @param {string} query
 * @param {object} [filters]
 * @param {"jb2a"|"psfx"} [filters.library]
 * @param {string} [filters.kind]
 * @param {string} [filters.shape]
 * @param {string|string[]} [filters.colors]  Any of these colours.
 * @param {boolean} [filters.persistent]
 * @param {string} [filters.category]
 * @returns {Family[]} Ranked families.
 */
export function search(catalog, query, filters = {}) {
  const idx = catalog._idx;
  const words = tok(query);
  const fams = catalog.families;
  const hasFilter = Object.values(filters).some(v => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length));
  if ( !words.length ) {
    return fams.filter((f, i) => !hasFilter || filterOk(f, filters, idx.info[i])).sort((a, b) => a.name.localeCompare(b.name));
  }
  let acc = null;
  for ( const word of words ) {
    const m = matchWord(idx, word);
    if ( acc === null ) acc = m;
    else {
      for ( const [i, s] of acc ) {
        const t = m.get(i);
        if ( t === undefined ) acc.delete(i);
        else acc.set(i, s + t);
      }
    }
    if ( !acc.size ) return [];
  }
  const qc = compact(words.join(""));
  const results = [];
  for ( const [i, s] of acc ) {
    const f = fams[i], ci = idx.info[i];
    if ( hasFilter && !filterOk(f, filters, ci) ) continue;
    let score = s;
    if ( words.every(w => { for ( const t of ci.nameToks ) if ( t.startsWith(w) ) return true; return false; }) ) score += 6;
    if ( ci.core.includes(qc) ) score += 30;
    else if ( words.length > 1 && words.some(w => ci.core.includes(w)) ) score += 8;
    else if ( words.length === 1 && ci.nameToks.has(words[0]) ) score += 4;
    score -= ci.nameLen * 0.15;
    results.push({ f, score });
  }
  results.sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name));
  return results.map(r => r.f);
}

/* -------------------------------------------- */
/*  Recommend                                   */
/* -------------------------------------------- */

const GROUP_CAP = { name: 40, namesyn: 14, dmg: 30, school: 16, status: 30, act: 12, words: 20 };

/**
 * Rank families for a spell/item/effect context.
 * @param {{families: Family[]}} catalog
 * @param {object} ctx
 * @param {string} [ctx.name]
 * @param {string[]} [ctx.words]
 * @param {string[]} [ctx.damageTypes]
 * @param {string} [ctx.school]
 * @param {"attack"|"save"|"heal"|"damage"|"utility"|"enchant"|"summon"|"check"} [ctx.activityType]
 * @param {"melee"|"ranged"} [ctx.attackType]
 * @param {"circle"|"cone"|"line"|"square"|"self"|"creature"} [ctx.targetShape]
 * @param {"projectile"|"melee"|"onToken"|"impact"|"area"|"aura"|"marker"|"sound"} [ctx.cue]
 * @param {string[]} [ctx.statuses]
 * @param {boolean} [ctx.persistent]
 * @param {"jb2a"|"psfx"} [ctx.library]
 * @param {object} [options]
 * @param {number} [options.limit=24]
 * @returns {{family: Family, score: number, why: string[], variant: Variant}[]}  `variant` is the best colour for the context.
 */
export function recommend(catalog, ctx = {}, { limit = 24 } = {}) {
  const idx = catalog._idx;
  const fams = catalog.families;
  const { N, df } = idx;
  const maxIdf = Math.log(N / 2);
  const idfW = t => 6 + 10 * Math.min(1, Math.log(N / (df.get(t) ?? 1)) / maxIdf);

  const soundOnly = ctx.cue === "sound";
  if ( soundOnly && ctx.library === "jb2a" ) return [];

  // Signals: vocabulary token -> [{ group, w, why }]
  const sig = new Map();
  const addSig = (word, group, w, why) => {
    if ( !word ) return;
    if ( word.includes("_") ) {
      for ( const part of word.split("_") ) if ( part.length >= 3 && !STOP.has(part) ) addSig(part, group, w * 0.6, why);
      return;
    }
    const hit = (t, mult) => {
      let l = sig.get(t);
      if ( !l ) sig.set(t, l = []);
      l.push({ group, w: w * mult, why });
    };
    for ( const t of df.keys() ) {
      if ( t === word ) hit(t, 1);
      else {
        const lo = Math.min(t.length, word.length), hi = Math.max(t.length, word.length);
        if ( lo >= 5 && lo / hi >= 0.6 && (t.startsWith(word) || word.startsWith(t)) ) hit(t, 0.7);
      }
    }
  };
  const addRelated = (key, group, w, why) => {
    addSig(key, group, w * 1.25, why);
    const e = SYNONYMS[key];
    if ( e ) for ( const rel of e.words ) addSig(rel, group, w, why);
  };

  const nameToks = tok(ctx.name).filter(t => !STOP.has(t));
  const nameCompact = compact(ctx.name);
  const nameCompactNoStop = nameToks.join("");
  for ( const t of nameToks ) {
    addSig(t, "name", idfW(t) * 2, `name word "${t}"`);
    for ( const [rel, w] of expandWord(t) ) addSig(rel, "namesyn", 8 * w, `related to "${t}"`);
  }
  for ( const w of ctx.words ?? [] ) {
    for ( const t of tok(w) ) {
      addSig(t, "words", idfW(t) * 0.8, `word "${t}"`);
      for ( const [rel, wt] of expandWord(t) ) addSig(rel, "words", 5 * wt, `related to "${t}"`);
    }
  }

  const colorPref = new Map();   // colour component -> { w, why }
  const addColors = (key, why, scale) => {
    (SYNONYMS[key]?.colors ?? []).forEach((c, n) => {
      const w = [11, 8, 5, 3][Math.min(n, 3)] * scale;
      for ( const part of new Set([c, ...colorParts(c)]) ) {
        const cur = colorPref.get(part);
        if ( !cur || cur.w < w ) colorPref.set(part, { w, why: `${part} fits ${why}` });
      }
    });
  };

  for ( const t of nameToks ) if ( SYNONYMS[t] ) addColors(t, t, 0.6);
  const dts = ctx.damageTypes ?? [];
  for ( const d of dts ) {
    const key = String(d).toLowerCase();
    addRelated(key, "dmg", 16 / Math.sqrt(dts.length), key === "healing" ? "healing" : `${key} damage`);
    addColors(key, key, 1 / Math.sqrt(dts.length));
  }
  if ( ctx.school ) {
    const key = String(ctx.school).toLowerCase();
    addRelated(key, "school", 9, `${SYNONYMS[key]?.words[0] ?? key} school`);
    addColors(key, "the school", 0.7);
  }
  for ( const s of ctx.statuses ?? [] ) {
    const key = String(s).toLowerCase();
    addRelated(key, "status", 18, `${key} status`);
    addColors(key, key, 0.9);
  }
  const actWords = ACTIVITY_WORDS[ctx.activityType] ?? [];
  for ( const w of actWords ) addSig(w, "act", 10, `${ctx.activityType} activity`);
  if ( actWords.length ) addColors(actWords[0], ctx.activityType, 0.6);

  // Kind / shape intent
  const kindW = new Map();
  const kindWhy = new Map();
  const setKind = (k, w, why) => { if ( w > (kindW.get(k) ?? 0) ) { kindW.set(k, w); kindWhy.set(k, why); } };
  if ( ctx.cue ) {
    setKind(ctx.cue, 30, `${ctx.cue} cue`);
    for ( const [k, w] of Object.entries(KIND_FIT[ctx.cue] ?? {}) ) setKind(k, w, `${k} suits a ${ctx.cue} cue`);
  }
  if ( ctx.attackType === "ranged" ) setKind("projectile", 22, "projectile fits a ranged attack");
  if ( ctx.attackType === "melee" ) setKind("melee", 22, "melee fits a melee attack");
  const ts = ctx.targetShape;
  const shapeW = {};
  if ( ts === "cone" ) { shapeW.cone = 16; setKind("area", 10, "area fits a cone"); }
  else if ( ts === "line" ) { shapeW.line = 14; setKind("projectile", 10, "projectile fits a line"); setKind("area", 8, "area fits a line"); }
  else if ( ts === "circle" ) { shapeW.circle = 12; setKind("area", 12, "area fits a circle"); setKind("impact", 8, "impact fits a circle"); }
  else if ( ts === "square" ) { shapeW.square = 14; setKind("area", 12, "area fits a square"); }
  else if ( ts === "self" ) { setKind("onToken", 10, "on token fits self"); setKind("aura", 8, "aura fits self"); }
  else if ( ts === "creature" ) { setKind("onToken", 5, "on token fits a creature"); setKind("impact", 4, "impact fits a creature"); }

  const scored = [];
  for ( let i = 0; i < fams.length; i++ ) {
    const f = fams[i];
    if ( ctx.library && f.library !== ctx.library ) continue;
    if ( soundOnly && f.kind !== "sound" ) continue;
    if ( ctx.cue && !soundOnly && !ctx.library && f.kind === "sound" ) continue;
    const ci = idx.info[i];
    let score = 0;
    const why = [];

    // 1. exact / near-exact name
    if ( nameCompact ) {
      let best = 0;
      for ( const c of ci.core ) {
        if ( c === nameCompact || c === nameCompactNoStop ) best = Math.max(best, 100);
        else if ( c.length >= 6 && nameCompact.length >= 6 && edit1(c, nameCompact) ) best = Math.max(best, 80);
        else if ( c.length >= 5 && nameCompact.length >= 5 && (c.includes(nameCompact) || nameCompact.includes(c)) ) best = Math.max(best, 35);
      }
      if ( best ) { score += best; why.push(best >= 80 ? "named like the item" : "name overlaps the item"); }
    }

    // 2. kind fit (sound families only have the one kind)
    if ( f.library === "jb2a" ) {
      const kw = kindW.get(f.kind);
      if ( kw ) { score += kw; why.push(kindWhy.get(f.kind)); }
      else if ( ctx.cue && ctx.cue !== "sound" ) score -= 6;
    } else if ( ctx.attackType === "melee" && /(swoosh|weapon-attacks|rend)/.test(f.id) ) {
      score += 14; why.push("weapon sound fits a melee attack");
    } else if ( ctx.attackType === "ranged" && /(ranged|missile|bolt|projectile|ray|longbow)/.test(f.id) ) {
      score += 14; why.push("ranged sound fits a ranged attack");
    }
    if ( f.shape && shapeW[f.shape] ) { score += shapeW[f.shape]; why.push(`${f.shape} shape`); }

    // 3-5. token signals, capped per group
    const groups = {};
    for ( const t of ci.lit ) {
      const l = sig.get(t);
      if ( !l ) continue;
      for ( const s of l ) {
        const g = groups[s.group] ??= { best: 0, sum: 0, why: "" };
        g.sum += s.w;
        if ( s.w > g.best ) { g.best = s.w; g.why = s.why; }
      }
    }
    for ( const [g, v] of Object.entries(groups) ) {
      score += Math.min(GROUP_CAP[g] ?? 20, v.best + 0.3 * (v.sum - v.best));
      why.push(v.why);
    }

    // Colour as a signal; also picks the best variant
    let variant = f.variants[0];
    if ( colorPref.size && f.colors.length ) {
      let bestC = 0, bestWhy = "";
      for ( const v of f.variants ) {
        if ( !v.color ) continue;
        let vw = 0, vwhy = "";
        for ( const part of new Set([v.color, ...colorParts(v.color)]) ) {
          const p = colorPref.get(part);
          if ( p && p.w > vw ) { vw = p.w; vwhy = p.why; }
        }
        if ( vw > bestC ) { bestC = vw; bestWhy = vwhy; variant = v; }
      }
      if ( bestC ) { score += bestC; why.push(bestWhy); }
    }

    if ( ctx.persistent === true ) { if ( f.persistent ) { score += 12; why.push("loops"); } }
    else if ( ctx.persistent === false && f.persistent ) score -= 8;

    if ( score <= 0 ) continue;
    score += Math.log2(1 + f.variants.length) * 0.6 - ci.nameLen * 0.1;
    scored.push({ family: f, score, why: [...new Set(why)].slice(0, 6), variant });
  }

  // Greedy pick with a mild repeat penalty per category so the list is not one animation family
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const seen = new Map();
  const pool = scored.slice(0, Math.max(limit * 6, 120));
  while ( picked.length < limit && pool.length ) {
    let bi = 0, bs = -Infinity;
    for ( let i = 0; i < pool.length; i++ ) {
      const p = pool[i];
      const s = p.score * Math.pow(0.9, seen.get(p.family.category) ?? 0);
      if ( s > bs ) { bs = s; bi = i; }
    }
    const [p] = pool.splice(bi, 1);
    seen.set(p.family.category, (seen.get(p.family.category) ?? 0) + 1);
    picked.push({ family: p.family, score: Math.round(bs * 10) / 10, why: p.why, variant: p.variant });
  }
  return picked;
}
