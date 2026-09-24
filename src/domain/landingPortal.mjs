// The landing page's portal mark: the Mshpit community mark with its two rings
// turning against each other. Geometry matches the master artwork (twelve
// figures outside, eight inside, heads facing out), and nothing else is drawn,
// so every still frame is the logo exactly.

export const PORTAL_VIEWBOX = 900;
const CENTER = PORTAL_VIEWBOX / 2;

// Ten full turns always end upright, so every pause shows the logo as drawn.
export const PORTAL_TURNS = 10;
export const PORTAL_SPIN_MS = 4_800;
export const PORTAL_HOLD_MS = 1_900;
export const PORTAL_OPEN_MS = 1_100;

const OUTER = Object.freeze({ count: 12, radius: 350, headY: -44, headR: 24, body: "M-50 44C-49 6-28-16 0-16S49 6 50 44C19 35-19 35-50 44Z" });
const INNER = Object.freeze({ count: 8, radius: 190, headY: -35, headR: 19, body: "M-40 35C-39 5-22-13 0-13S39 5 40 35C15 28-15 28-40 35Z" });

function figures(ring) {
  return Array.from({ length: ring.count }, (_, index) => ({
    key: `${ring.count}-${index}`,
    transform: `translate(${CENTER} ${CENTER}) rotate(${(360 / ring.count) * index}) translate(0 ${-ring.radius})`,
    headY: ring.headY,
    headR: ring.headR,
    body: ring.body,
  }));
}

export const PORTAL_OUTER_FIGURES = Object.freeze(figures(OUTER));
export const PORTAL_INNER_FIGURES = Object.freeze(figures(INNER));

// Rotation and the light speed fade follow one value measured in turns; the
// figures are fully solid at both stops.
export const PORTAL_SPEED_INPUT = Object.freeze([0, 0.7, PORTAL_TURNS - 0.7, PORTAL_TURNS]);
