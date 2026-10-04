/**
 * Alivas's Engine of Triggers — flanking (2014 DMG p. 251, optional rule; squares only).
 *
 * The rule: a creature that makes a MELEE attack roll against an enemy it can see has Advantage (or a bonus, see the
 * settings) when it is "flanking" that enemy: an ally of the attacker is also adjacent to the target, on the opposite
 * side or the opposite corner of the target's space. The ally must be able to see the target and must not be
 * Incapacitated; the attacker must not be Incapacitated either.
 *
 * Settings (settings.mjs, read with opt()):
 *   flanking         "off" | "advantage" | "plus2" | "custom"
 *   flankingFormula  the modifier for "custom" (a number or a roll formula, e.g. "1d4")
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
  if ( !attackerToken || !targetToken || !isFlanking(attackerToken, targetToken) ) return;

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
