// Route anchors derived from the new reference image composition.
// Centres of LIFECYCLE_ZONES defined in rendering/world-scene.js.
//
//   intakeDesk    → centre of CREATED  zone  (x:25–190,  y:55–210)  ≈ (107, 133)
//   workerDesks   → CLAIMED desk slots (x:218–376, y:140–360) matching DESK_POSITIONS
//                   + ENQUEUED floor positions (x:15–220, y:270–470) for overflow agents
//   executionZone → centre of EXECUTE_FINISHED (x:578–736, y:140–360) ≈ (657, 250)
//   deliveryZone  → centre of ACKED            (x:806–1026, y:42–490) ≈ (916, 266)
export const officeLayout = {
  intakeDesk: { x: 107, y: 133 },
  workerDesks: [
    { x: 272, y: 250 },
    { x: 304, y: 255 },
    { x: 336, y: 250 },
    { x:  90, y: 355 },
    { x: 130, y: 360 },
    { x: 170, y: 355 }
  ],
  executionZone: { x: 657, y: 250 },
  deliveryZone:  { x: 916, y: 266 }
};
