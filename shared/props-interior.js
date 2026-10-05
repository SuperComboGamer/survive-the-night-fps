// Footprints of what is in the rooms of Port Calder (as shared/props.js: size, boxes, cyls, desc).
// Where a thing stands against a wall with the floor in front of it for what was pulled out of it (the bookcase, the
// chest of drawers, the filing cabinet), its body is at the back (+Z) of the size box and only the body is solid.
export const INTERIOR_PROP_DEFS = {
  // ---- homes
  sofa: { size: [2.0, 0.85, 0.9], boxes: [[0, 0.4, 0, 2.0, 0.8, 0.9]], desc: 'a three-seat sofa: loose seat and back cushions, one slashed open with the stuffing out, stains. Variant 2 lies thrown onto its back, its feet to -Z' },
  armchair: { size: [0.9, 0.9, 0.9], boxes: [[0, 0.4, 0, 0.9, 0.8, 0.9]], desc: 'an upholstered armchair, its cushion slashed (0) or pulled up against the back (1)' },
  kitchen_counter: { size: [2.0, 0.92, 0.62], boxes: [[0, 0.46, 0, 2.0, 0.92, 0.62]], desc: 'kitchen base units under a worktop, a steel sink and tap at the -X end: a door gone on a shelf of tins, a door ajar, a drawer pulled, a drawer missing' },
  stove: { size: [0.7, 0.95, 0.65], boxes: [[0, 0.475, 0, 0.7, 0.95, 0.65]], desc: 'an enamel cooker: four rings, knobs, a splash panel, a pan left on it, rust; the oven door ajar (0) or torn off (1)' },
  kitchen_table: { size: [1.4, 0.85, 0.85], boxes: [[0, 0.39, 0, 1.4, 0.78, 0.85]], desc: 'a laminate kitchen table on tube legs with a last meal on it (0), or thrown on its side with its top to -Z (1: it stands 0.81 high)' },
  tv_set: { size: [1.0, 1.15, 0.5], boxes: [[0, 0.575, 0, 1.0, 1.15, 0.5]], desc: 'a television on a low stand: a wood-grain case, a bulged tube (smashed in variant 1), knobs, a rabbit-ear aerial, a video recorder on the shelf under it' },
  bookshelf: { size: [0.95, 1.95, 0.9], boxes: [[0, 0.975, 0.275, 0.95, 1.95, 0.35]], desc: 'a tall bookcase (at the back of its footprint): rows of books with gaps, some leaning, a few on the floor in front (0); or nearly emptied onto a heap at its foot (1)' },
  wardrobe: { size: [1.1, 2.0, 0.6], boxes: [[0, 1.0, 0, 1.1, 2.0, 0.6]], desc: 'a wardrobe with two sliding doors: one slid across on clothes on hangers and a heap at the bottom (0), or both doors gone and the track hanging (1)' },
  dresser: { size: [1.0, 0.85, 0.9], boxes: [[0, 0.425, 0.2, 1.0, 0.85, 0.5]], desc: 'a chest of drawers (at the back of its footprint), the drawers pulled out to different lengths with clothes over the lip; variant 1 has drawers missing and one upside down on the floor in front' },
  double_bed: { size: [1.5, 0.75, 2.05], boxes: [[0, 0.3, 0, 1.5, 0.6, 2.05]], desc: 'a wooden double bed, headboard to +Z: a stained mattress, a rumpled blanket and a pillow (0); the mattress down through the slats on one side (1); bare slats (2)' },
  bathtub: { size: [0.8, 0.6, 1.7], boxes: [[0, 0.3, 0, 0.8, 0.6, 1.7]], desc: 'a cast-iron roll-top bath on claw feet, taps at the +Z end, a brown tide line inside; variant 1 has dried blood pooled in it' },
  toilet: { size: [0.45, 0.8, 0.7], boxes: [[0, 0.4, 0, 0.45, 0.8, 0.7]], desc: 'a lavatory, the cistern at +Z: the seat up, the cistern cracked and half its lid gone' },
  rug: { size: [2.6, 0.02, 1.8], desc: 'a worn carpet flat on the floor: two borders round a field, a medallion, one corner turned over, stains' },
  blood_pool: { size: [1.6, 0.01, 1.6], desc: 'dried blood on a floor: a pool (0), a pool and drag marks leading from it (1, 2)' },
  ceiling_debris: { size: [2.4, 0.5, 2.4], desc: 'what came down from a ceiling: broken plasterboard and tiles at angles, battens, a strip light on the floor with its tubes broken' },
  ceiling_lamp: { size: [1.3, 0.5, 0.3], desc: 'a ceiling light, THE ORIGIN AT THE CEILING (it hangs down to y = -0.5): a twin-tube batten (0), the same hanging by one end (1), a bare flex with a broken bulb (2)' },
  // ---- shops
  shop_gondola: { size: [2.4, 1.6, 0.9], boxes: [[0, 0.8, 0, 2.4, 1.6, 0.9]], desc: 'a double-sided supermarket shelving bay along X: steel uprights, a spine, four levels a side with price rails; a remnant of stock, much of it toppled (0); nearly stripped, a shelf hanging by one end (1); racked over toward -Z with the shelves of that side down (2)' },
  checkout_counter: { size: [2.2, 1.1, 0.9], boxes: [[0, 0.47, 0, 2.2, 0.94, 0.9]], desc: 'a supermarket till, customers to -Z: a belt, a scanner, a card reader on a stalk, a bag rack, the register on the cashier side with its drawer open and empty, a sweet rack knocked over on the belt; variant 1 has the register ripped out' },
  display_fridge: { size: [1.3, 2.0, 0.75], boxes: [[0, 1.0, 0, 1.3, 2.0, 0.75]], desc: 'an upright two-door drinks chiller with a dead light box on top: one door ajar, one smashed, wire shelves, a few bottles, mould (0); a door gone and the shelves down (1)' },
  vending_machine: { size: [0.95, 1.85, 0.85], boxes: [[0, 0.925, 0, 0.95, 1.85, 0.85]], desc: 'a snack machine, its glass smashed and its coils empty; in variant 1 the whole front is prised open on its hinges' },
  stock_spill: { size: [2.0, 0.3, 2.0], desc: 'stock swept to the floor in a patch: tins, boxes, packets, a bottle, crushed cartons, a burst sack' },
  // ---- offices, the police station
  office_desk: { size: [1.6, 1.15, 0.8], boxes: [[0, 0.38, 0, 1.6, 0.76, 0.8]], desc: 'a steel-and-laminate desk (the sitter at -Z) with a drawer pedestal, drawers pulled: a dead monitor, keyboard, a phone off the hook and papers (0); swept clean with the monitor on its side (1); thrown on its side as a barricade, top to -Z (2)' },
  office_chair: { size: [1.05, 1.0, 0.7], desc: 'a swivel chair on a five-star base with castors; variant 1 lies on its side along X' },
  filing_cabinet: { size: [0.5, 1.35, 1.2], boxes: [[0, 0.675, 0.275, 0.5, 1.35, 0.65]], desc: 'a four-drawer filing cabinet (at the back of its footprint): two drawers pulled out with hanging files, papers on the floor in front; variant 1 has a drawer gone' },
  paper_scatter: { size: [2.2, 0.02, 2.2], desc: 'loose sheets of paper and a few folders over a floor' },
  reception_desk: { size: [3.4, 1.65, 1.0], boxes: [[0, 0.55, 0, 3.4, 1.1, 1.0]], desc: 'a front desk: a raised public counter along -Z with a lower work surface and drawers behind (+Z), a screen on the counter up to 1.63 m (glass, one pane smashed), a bell, a plaque, a ledger; variant 1 is the police front desk: steel, a mesh grille with a hatch, a dead radio' },
  waiting_chairs: { size: [1.8, 0.85, 0.6], boxes: [[0, 0.22, 0, 1.8, 0.45, 0.6]], desc: 'a beam-mounted row of three moulded seats, one broken off its bracket (variant 1: lying under the row)' },
  cell_bars: {
    size: [3.0, 2.4, 0.1],
    boxes: [[-0.85, 1.2, 0, 1.3, 2.4, 0.08], [1.2, 1.2, 0, 0.6, 2.4, 0.08]],
    desc: 'the barred front of a jail cell along X: round bars every 0.12 m, flat rails, the gateway open between x = -0.2 and 0.9 with bars over it above 2.3 m; the gate itself, with its lock box, stands swung right back into +Z behind the bars on the +X side (it runs from x = 0.88 to 1.4 and reaches z = 0.95: the one part outside the size box, and it has no collider)',
  },
  cell_bunk: { size: [0.8, 0.5, 1.95], boxes: [[0, 0.22, 0, 0.8, 0.45, 1.95]], desc: 'a steel bunk hung off the wall at +X (struts on that side, two legs on the other): a thin stained mattress and a blanket (0), or the bare rusted plate (1)' },
  // ---- the hospital
  hospital_bed: { size: [0.95, 1.15, 2.15], boxes: [[0, 0.35, 0, 0.95, 0.7, 2.15]], desc: 'a wheeled hospital bed, head to +Z: tube frame, castors, head and foot boards, one side rail up and one down, a stained sheet dragged half off; the head section raised (1); somebody under the sheet (2)' },
  privacy_curtain: { size: [2.2, 2.0, 0.5], desc: 'a hospital screen along X: a pleated curtain on a wheeled tube frame, torn and off half its hooks (0), or a three-panel folding screen (1)' },
  gurney: { size: [0.7, 0.95, 1.95], boxes: [[0, 0.4, 0, 0.7, 0.8, 1.95]], desc: 'an ambulance stretcher on scissor legs, head to +Z, straps hanging; variant 1 is folded flat and lies on its side' },
  medical_cart: { size: [0.6, 1.0, 0.45], boxes: [[0, 0.5, 0, 0.6, 1.0, 0.45]], desc: 'a red crash cart on castors: drawers pulled, one gone, bottles and a dish on top, a push handle at +X' },
  // ---- the picture house, the subway
  cinema_seats: { size: [2.2, 0.95, 0.7], boxes: [[0, 0.4, 0.1, 2.2, 0.8, 0.5]], desc: 'a row of four tip-up cinema seats on a floor rail, facing -Z: red velour, wooden arm rests, some seats down, one slashed, one back ripped off' },
  turnstiles: {
    size: [2.6, 1.1, 1.3],
    boxes: [[-1.1, 0.5, 0, 0.35, 1.0, 1.2], [0, 0.5, 0, 0.35, 1.0, 1.2], [1.1, 0.5, 0, 0.35, 1.0, 1.2]],
    desc: 'three stainless subway turnstile housings with coin units (the way in from -Z), the two lanes between them passable: one tripod arm hangs, the rest are broken off',
  },
  door_barricade: { size: [1.6, 1.7, 0.8], boxes: [[0, 0.8, 0, 1.6, 1.6, 0.8]], desc: 'a doorway (behind it, at +Z) blocked from this side: a table on its side, a cupboard, chairs, planks nailed across (0); a mattress stood against it, a bookcase on its side, chairs, a brace (1)' },
};
