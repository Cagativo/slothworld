/**
 * worldZones.js
 *
 * Named semantic zones for the Slothworld treehouse command-center.
 *
 * PROJECTION BOUNDARY:
 *  - This module is pure configuration: no events, no selectors, no lifecycle logic.
 *  - All coordinates are absolute pixel positions on the 1060×520 canvas.
 *  - Each zone declares which LIFECYCLE_ZONE (from rendering/world-scene.js) it
 *    overlaps, for reference only — this module never imports from rendering/.
 *  - Consumers MUST NOT read raw events to pick a zone; use worldZoneMapper.js
 *    which accepts only selector-derived entity descriptors.
 *
 * Zone catalogue:
 *  intakeDesk    — Newly-created tasks waiting to be enqueued (CREATED zone center)
 *  engineCrystal — Central processing hub / the crystal tree (CENTRAL_STRUCTURE)
 *  researchDesk  — TREND_RESEARCH task execution area (CLAIMED sub-slot)
 *  shopifyDesk   — SHOPIFY task execution area (CLAIMED sub-slot)
 *  renderDesk    — IMAGE_RENDER task execution area (CLAIMED sub-slot)
 *  supportDesk   — DISCORD task execution area (ENQUEUED/CLAIMED transition)
 *  approvalDesk  — Tasks awaiting acknowledgment (EXECUTE_FINISHED zone center)
 *  anomalyShelf  — Failed tasks and incident indicators (upper ACKED zone)
 *  archiveLibrary — Completed/acknowledged tasks (ACKED zone center)
 *
 * @typedef {{ id: string, label: string, position: { x: number, y: number }, size: { width: number, height: number }, lifecycleZoneId: string | null }} WorldZone
 */

/** @type {Readonly<Record<string, WorldZone>>} */
export const WORLD_ZONES = Object.freeze({
  /**
   * Upper-left cozy alcove — tasks are placed here upon creation/enqueueing.
   * Matches the center of the CREATED lifecycle zone (x:25–190, y:55–210).
   */
  intakeDesk: Object.freeze({
    id:             'intakeDesk',
    label:          'Intake Desk',
    position:       Object.freeze({ x: 107, y: 133 }),
    size:           Object.freeze({ width: 165, height: 155 }),
    lifecycleZoneId: 'CREATED',
  }),

  /**
   * Central tree / crystal hub — default anchor for the engine and idle workers.
   * Centered on the CENTRAL_STRUCTURE (x:380–580, y:15–435).
   */
  engineCrystal: Object.freeze({
    id:             'engineCrystal',
    label:          'Engine Crystal',
    position:       Object.freeze({ x: 480, y: 225 }),
    size:           Object.freeze({ width: 200, height: 220 }),
    lifecycleZoneId: null,
  }),

  /**
   * Research station — TREND_RESEARCH tasks execute here.
   * Upper sub-slot of the CLAIMED zone (x:218–376, y:140–360).
   */
  researchDesk: Object.freeze({
    id:             'researchDesk',
    label:          'Research Desk',
    position:       Object.freeze({ x: 272, y: 185 }),
    size:           Object.freeze({ width: 80, height: 70 }),
    lifecycleZoneId: 'CLAIMED',
  }),

  /**
   * Commerce station — SHOPIFY tasks execute here.
   * Mid sub-slot of the CLAIMED zone.
   */
  shopifyDesk: Object.freeze({
    id:             'shopifyDesk',
    label:          'Shopify Desk',
    position:       Object.freeze({ x: 310, y: 255 }),
    size:           Object.freeze({ width: 80, height: 70 }),
    lifecycleZoneId: 'CLAIMED',
  }),

  /**
   * Rendering station — IMAGE_RENDER tasks execute here.
   * Lower sub-slot of the CLAIMED zone.
   */
  renderDesk: Object.freeze({
    id:             'renderDesk',
    label:          'Render Desk',
    position:       Object.freeze({ x: 272, y: 310 }),
    size:           Object.freeze({ width: 80, height: 70 }),
    lifecycleZoneId: 'CLAIMED',
  }),

  /**
   * Support station — DISCORD tasks route through here.
   * Lower-left area bridging ENQUEUED and CLAIMED (desk slot 3 position).
   */
  supportDesk: Object.freeze({
    id:             'supportDesk',
    label:          'Support Desk',
    position:       Object.freeze({ x: 100, y: 355 }),
    size:           Object.freeze({ width: 80, height: 70 }),
    lifecycleZoneId: 'ENQUEUED',
  }),

  /**
   * Approval station — tasks land here after execution, awaiting acknowledgment.
   * Center of the EXECUTE_FINISHED lifecycle zone (x:578–736, y:140–360).
   */
  approvalDesk: Object.freeze({
    id:             'approvalDesk',
    label:          'Approval Desk',
    position:       Object.freeze({ x: 657, y: 250 }),
    size:           Object.freeze({ width: 158, height: 220 }),
    lifecycleZoneId: 'EXECUTE_FINISHED',
  }),

  /**
   * Anomaly shelf — failed tasks and incident cluster indicators live here.
   * Upper portion of the ACKED vine-wall zone (x:806–1026, y:42–490).
   */
  anomalyShelf: Object.freeze({
    id:             'anomalyShelf',
    label:          'Anomaly Shelf',
    position:       Object.freeze({ x: 860, y: 70 }),
    size:           Object.freeze({ width: 110, height: 110 }),
    lifecycleZoneId: 'ACKED',
  }),

  /**
   * Archive library — successfully acknowledged tasks are shelved here.
   * Center of the ACKED lifecycle zone (x:806–1026, y:42–490).
   */
  archiveLibrary: Object.freeze({
    id:             'archiveLibrary',
    label:          'Archive Library',
    position:       Object.freeze({ x: 916, y: 266 }),
    size:           Object.freeze({ width: 220, height: 338 }),
    lifecycleZoneId: 'ACKED',
  }),
});

/** All zone IDs in canonical order for enumeration. */
export const WORLD_ZONE_IDS = Object.freeze(Object.keys(WORLD_ZONES));
