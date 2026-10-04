/**
 * Alivas's Engine of Triggers — flanking (2014 DMG p. 251, optional rule; squares only).
 *
 * The rule: a creature that makes a MELEE attack roll against an enemy it can see has Advantage (or a bonus, see the
 * settings) when it is "flanking" that enemy: an ally of the attacker is also adjacent to the target, on the opposite
 * side or the opposite corner of the target's space. The ally must be able to see the target and must not be
 * Incapacitated; the attacker must not be Incapacitated either.
 *
 * Settings (settings.mjs, read with opt()):
 *   flanking         "off" | "advantage" | "plus2" | "custom" | "surround"
 *   flankingFormula  the modifier for "custom" (a number or a roll formula, e.g. "1d4")
 *
 * Variant "surround" (after Aardvark's Flanking; any grid, also gridless): a creature is flanked while two or more of
 * its opponents (creatures their faction regards as hostile to it) threaten it — each can see it, isn't Incapacitated,
 * wields a melee weapon (an equipped melee weapon, natural weapons included, an Unarmed Strike not) and has it within
 * that weapon's reach — and at least two of them are on opposite sides of it: the straight line between their centres
 * (in 3D: token size and elevation count) passes through the target's space. Melee attacks against a flanked creature
 * by one of its opponents get +1 for each opponent threatening it, up to the attacker's Proficiency Bonus. Stacks with
 * Advantage.
 *
 * Geometry (grid cells, from TokenDocument#getOccupiedGridSpaceOffsets(); i = row, j = column): the target occupies a
 * rectangle of cells. A flanker cell touching that rectangle lies in one of eight regions around it, written (di, dj)
 * with di = -1 above, +1 below, 0 within the rows of the target; dj likewise for columns. Two creatures flank when one
 * of the attacker's cells and one of the ally's cells are in opposite regions (di, dj) and (-di, -dj). That covers
 * opposite sides and opposite corners, and a Large (or bigger) flanker counts through any of its cells.
 *
 * Applied at `dnd5e.preRollAttackV2`: Advantage sets config.advantage; the bonus pushes a part into the roll's `parts`
 * (dnd5e keeps them, then appends the weapon's own parts), so it is part of the formula and shown in the roll tooltip.
 * Only when exactly one target is selected on the rolling client (multi-target melee is rare). A short " (flanking)"
 * is appended to the chat message flavor.
 */
import { opt } from "./settings.mjs";
import * as Creatures from "./creatures.mjs";

/** Statuses that stop a creature from flanking (Incapacitated and what implies it, or death). */
const INCAPACITATED = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"];

/**
 * Which of the eight regions around a rectangle a cell lies in.
 * @param {{i:number,j:number}} cell
 * @param {{i0:number,i1:number,j0:number,j1:number}} box  The target's cell rectangle (inclusive).
 * @returns {[number,number]|null}  [di, dj], or null when the cell is inside the box or not adjacent to it.
 */
function regionOf(cell, box) {
  const di = cell.i < box.i0 ? -1 : (cell.i > box.i1 ? 1 : 0);
  const dj = cell.j < box.j0 ? -1 : (cell.j > box.j1 ? 1 : 0);
  if ( !di && !dj ) return null;                                  // inside the target's space
  if ( (di && Math.abs(cell.i - (di < 0 ? box.i0 : box.i1)) !== 1) ) return null;
  if ( (dj && Math.abs(cell.j - (dj < 0 ? box.j0 : box.j1)) !== 1) ) return null;
  return [di, dj];
}

/**
 * Pure geometry: do the attacker and the ally flank the target?
 * @param {{i:number,j:number}[]} attackerCells  Grid cells the attacker occupies.
 * @param {{i:number,j:number}[]} allyCells      Grid cells the ally occupies.
 * @param {{i:number,j:number}[]} targetCells    Grid cells the target occupies.
 * @returns {boolean}
 */
export function flankingCells(attackerCells, allyCells, targetCells) {
  if ( !attackerCells?.length || !allyCells?.length || !targetCells?.length ) return false;
  const box = {
    i0: Math.min(...targetCells.map(c => c.i)), i1: Math.max(...targetCells.map(c => c.i)),
    j0: Math.min(...targetCells.map(c => c.j)), j1: Math.max(...targetCells.map(c => c.j))
  };
  const attackerRegions = attackerCells.map(c => regionOf(c, box)).filter(Boolean);
  const allyRegions = allyCells.map(c => regionOf(c, box)).filter(Boolean);
  return attackerRegions.some(([di, dj]) => allyRegions.some(([ei, ej]) => (ei === -di) && (ej === -dj)));
}

/**
 * Is a token's creature unable to take part (Incapacitated or dead)?
 * @param {TokenDocument} tokenDoc
 * @returns {boolean}
 */
function incapacitated(tokenDoc) {
  const statuses = tokenDoc.actor?.statuses;
  return !!statuses && INCAPACITATED.some(s => statuses.has(s));
}

/**
 * Grid cells a token occupies, as {i, j}.
 * @param {TokenDocument} tokenDoc
 * @returns {{i:number,j:number}[]}
 */
function cellsOf(tokenDoc) {
  try { return tokenDoc.getOccupiedGridSpaceOffsets?.() ?? []; } catch { return []; }
}

/**
 * Is the attacker flanking the target? Checks the relation (enemy), sight, Incapacitated and the geometry.
 * @param {TokenDocument} attackerToken
 * @param {TokenDocument} targetToken
 * @returns {boolean}
 */
export function isFlanking(attackerToken, targetToken) {
  const scene = attackerToken?.parent;
  if ( !scene || (targetToken?.parent !== scene) || (attackerToken === targetToken) ) return false;
  if ( canvas.grid?.type !== CONST.GRID_TYPES.SQUARE ) return false;
  const attacker = attackerToken.actor;
  const target = targetToken.actor;
  if ( !attacker || !target ) return false;
  if ( Creatures.relation(attacker, target, scene) !== "enemy" ) return false;
  if ( incapacitated(attackerToken) || !Creatures.canSee(attackerToken, targetToken) ) return false;

  const targetCells = cellsOf(targetToken);
  const attackerCells = cellsOf(attackerToken);
  if ( !targetCells.length || !attackerCells.length ) return false;

  for ( const ally of scene.tokens ) {
    if ( (ally === attackerToken) || (ally === targetToken) || ally.hidden || !ally.actor ) continue;
    if ( Creatures.relation(attacker, ally.actor, scene) !== "ally" ) continue;
    if ( incapacitated(ally) || !Creatures.canSee(ally, targetToken) ) continue;
    if ( flankingCells(attackerCells, cellsOf(ally), targetCells) ) return true;
  }
  return false;
}

/* -------------------------------------------- */
/*  Variant "surround"                          */
/* -------------------------------------------- */

/**
 * A token's box in feet: x / y from its position and size, z from its elevation up to its height (its size in feet:
 * Medium 5 ft, Large 10 ft…).
 * @param {TokenDocument} t
 * @returns {{x0:number,x1:number,y0:number,y1:number,z0:number,z1:number}}
 */
function boxFt(t) {
  const grid = t.parent.grid;
  const k = grid.distance / grid.size;
  const x0 = t._source.x * k, y0 = t._source.y * k;
  const w = t.width * grid.distance, h = t.height * grid.distance;
  const z0 = Number(t.elevation ?? 0);
  return { x0, x1: x0 + w, y0, y1: y0 + h, z0, z1: z0 + Math.max(w, h) };
}

const centre = b => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];

/**
 * Pure geometry: does the segment from p to q pass through the box, inset by eps on every side (so a line clipping an
 * edge or a corner doesn't count)? Slab method.
 * @param {number[]} p  [x, y, z]
 * @param {number[]} q  [x, y, z]
 * @param {{x0,x1,y0,y1,z0,z1}} box
 * @param {number} [eps=1]  Inset, in the box's units (feet): a fifth of a 5 ft square rules out "N and SE" on a Medium
 *                           target (the DMG's opposite sides / corners only) while two flankers straight across a Large
 *                           one still count.
 * @returns {boolean}
 */
export function segmentThroughBox(p, q, box, eps=1) {
  const lo = [box.x0 + eps, box.y0 + eps, box.z0 + eps];
  const hi = [box.x1 - eps, box.y1 - eps, box.z1 - eps];
  let t0 = 0, t1 = 1;
  for ( let a = 0; a < 3; a++ ) {
    const d = q[a] - p[a];
    if ( Math.abs(d) < 1e-9 ) {
      if ( (p[a] <= lo[a]) || (p[a] >= hi[a]) ) return false;
      continue;
    }
    let ta = (lo[a] - p[a]) / d, tb = (hi[a] - p[a]) / d;
    if ( ta > tb ) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if ( t0 >= t1 ) return false;
  }
  return true;
}

/**
 * Distance in feet between two tokens, counting elevation: the larger of the horizontal distance (as Opportunity
 * Attacks measure it) and the vertical gap between their boxes plus one square.
 * @param {TokenDocument} a
 * @param {TokenDocument} b
 * @returns {number}
 */
function distance3d(a, b) {
  const flat = Creatures.distanceFt(a, b);
  const A = boxFt(a), B = boxFt(b);
  const gap = Math.max(0, Math.max(A.z0, B.z0) - Math.min(A.z1, B.z1));
  return Math.max(flat, gap ? gap + a.parent.grid.distance : 0);
}

/**
 * The longest reach among the melee weapons a creature wields (equipped weapons with a melee attack; natural weapons
 * count, an Unarmed Strike doesn't). 0 when it wields none.
 * @param {Actor} actor
 * @returns {number}
 */
function meleeReach(actor) {
  let reach = 0;
  for ( const item of actor?.items ?? [] ) {
    if ( (item.type !== "weapon") || (item.system.identifier === "unarmed-strike") ) continue;
    if ( !item.system.equipped && (item.system.type?.value !== "natural") ) continue;
    const melee = (item.system.activities ?? []).some(a => (a.type === "attack") && (a.attack?.type?.value === "melee"));
    if ( !melee ) continue;
    reach = Math.max(reach, item.system.range?.reach || (item.system.properties?.has("rch") ? 10 : 5));
  }
  return reach;
}

/**
 * The opponents flanking a creature under the "surround" variant: every opponent threatening it, when at least two of
 * them are on opposite sides; else none.
 * @param {TokenDocument} targetToken
 * @returns {TokenDocument[]}
 */
export function flankersOf(targetToken) {
  const scene = targetToken?.parent;
  const target = targetToken?.actor;
  if ( !scene || !target ) return [];
  const threatening = [];
  for ( const t of scene.tokens ) {
    if ( (t === targetToken) || t.hidden || !t.actor ) continue;
    if ( Creatures.relation(t.actor, target, scene) !== "enemy" ) continue;
    if ( incapacitated(t) || !Creatures.canSee(t, targetToken) ) continue;
    const reach = meleeReach(t.actor);
    if ( !reach || (distance3d(t, targetToken) > reach) ) continue;
    threatening.push(t);
  }
  if ( threatening.length < 2 ) return [];
  const box = boxFt(targetToken);
  const centres = threatening.map(t => centre(boxFt(t)));
  for ( let i = 0; i < centres.length; i++ ) {
    for ( let j = i + 1; j < centres.length; j++ ) {
      if ( oppositeSides(centres[i], centres[j], box, scene.grid.distance / 5) ) return threatening;
    }
  }
  return [];
}

/**
 * Pure geometry: are two points on opposite sides of a box? Either seen from above (the line between them, at the
 * box's mid-height, crosses its middle: flyers hovering on both sides still flank) or in 3D (one above, one below).
 * @param {number[]} p  [x, y, z]
 * @param {number[]} q  [x, y, z]
 * @param {{x0,x1,y0,y1,z0,z1}} box
 * @param {number} [eps=1]  See segmentThroughBox.
 * @returns {boolean}
 */
export function oppositeSides(p, q, box, eps=1) {
  const mid = (box.z0 + box.z1) / 2;
  return segmentThroughBox([p[0], p[1], mid], [q[0], q[1], mid], box, eps) || segmentThroughBox(p, q, box, eps);
}

/**
 * The "surround" bonus for a melee attack: +1 per opponent flanking the target, up to the attacker's Proficiency
 * Bonus; 0 when the target isn't flanked or the attacker isn't one of its opponents.
 * @param {TokenDocument} attackerToken
 * @param {TokenDocument} targetToken
 * @returns {number}
 */
export function surroundBonus(attackerToken, targetToken) {
  const scene = attackerToken?.parent;
  if ( !scene || (targetToken?.parent !== scene) || (attackerToken === targetToken) ) return 0;
  if ( Creatures.relation(attackerToken.actor, targetToken.actor, scene) !== "enemy" ) return 0;
  const count = flankersOf(targetToken).length;
  const pb = Number(attackerToken.actor?.system.attributes?.prof ?? 0) || 2;
  return Math.min(count, pb);
}

/**
 * `dnd5e.preRollAttackV2`: apply flanking to a melee attack against the single selected target.
 * @param {object} config   Attack roll process configuration (config.subject is the attack activity).
 * @param {object} dialog   Dialog configuration.
 * @param {object} message  Message configuration (message.data.flavor).
 */
function onPreRollAttack(config, dialog, message) {
  const mode = opt("flanking");
  if ( !mode || (mode === "off") ) return;
  const activity = config.subject;
  if ( activity?.attack?.type?.value !== "melee" ) return;
  if ( String(config.attackMode ?? "").startsWith("thrown") ) return;         // a thrown weapon is a ranged attack
  const targets = Array.from(game.user.targets ?? []);
  if ( targets.length !== 1 ) return;                                         // multi-target melee: not handled
  const attackerToken = Creatures.tokenFor(activity.actor, canvas.scene);
  const targetToken = targets[0].document;
  if ( !attackerToken || !targetToken ) return;
  if ( mode === "surround" ) {
    const bonus = surroundBonus(attackerToken, targetToken);
    if ( !bonus ) return;
    config.rolls ??= [{}];
    config.rolls[0] ??= {};
    config.rolls[0].parts = [...(config.rolls[0].parts ?? []), String(bonus)];
    if ( message?.data ) message.data.flavor = `${message.data.flavor ?? ""} (flanked: +${bonus})`;
    return;
  }
  if ( !isFlanking(attackerToken, targetToken) ) return;

  if ( mode === "advantage" ) config.advantage = true;
  else {
    const part = (mode === "plus2") ? "2" : String(opt("flankingFormula") ?? "").trim();
    if ( !part ) return;
    config.rolls ??= [{}];
    config.rolls[0] ??= {};
    config.rolls[0].parts = [...(config.rolls[0].parts ?? []), part];
  }
  if ( message?.data ) message.data.flavor = `${message.data.flavor ?? ""} (flanking)`;
}

/** Register the flanking hook (called once from main.mjs during init). */
export function registerFlanking() {
  Hooks.on("dnd5e.preRollAttackV2", onPreRollAttack);
}
