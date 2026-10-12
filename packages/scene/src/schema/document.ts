import { z } from "zod";

export const SCHEMA_VERSION = 1;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const IdSchema = z
  .string()
  .regex(
    IDENTIFIER,
    "must contain only letters, digits and underscores, and not start with a digit",
  )
  .max(40)
  .meta({ id: "Id", description: "Letters, digits and underscores; does not start with a digit." });

export const TargetSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, 'must be an element id or "element.part"')
  .max(80)
  .meta({ id: "Target", description: 'An element id, or "elementId.part" for a named part.' });

export const BindableSchema = z
  .union([z.number(), z.strictObject({ expr: z.string().min(1).max(200) })])
  .meta({
    id: "Bindable",
    description:
      'A number, or { "expr": "…" } computed from parameters, constants and derived values. Never compute a number yourself: bind it.',
  });

export const PointSchema = z
  .tuple([BindableSchema, BindableSchema])
  .meta({ id: "Point", description: "[x, y] in the mathematical frame of the scene (`world`)." });

export const AnchorSchema = z.union([PointSchema, IdSchema]).meta({
  id: "Anchor",
  description: "A Point, or the id of a point, object or shape of the same slot.",
});

export const ROLE_COLOURS = ["quantity", "action", "result", "valid"] as const;
export const RoleColourSchema = z.enum(ROLE_COLOURS).meta({ id: "Role" });

export const COLOURS = ["ink", "inkSoft", ...ROLE_COLOURS] as const;
export const ColourSchema = z.enum(COLOURS).meta({
  id: "Colour",
  description:
    'Colour is a code, never decoration: "quantity" = a given quantity the student can vary, "action" = a force, flow or cause, "result" = what to remember (fill only), "valid" = correct or a second series, "ink" = structure.',
});

export const PICTOGRAMS = [
  "planet",
  "moon",
  "sun",
  "apple",
  "ball",
  "block",
  "spring",
  "person",
  "battery",
  "bulb",
  "resistor",
  "beaker",
  "molecule",
  "cell",
  "leaf",
  "coin",
  "basket",
] as const;
export const PictogramSchema = z.enum(PICTOGRAMS).meta({ id: "Pictogram" });

export const LANGUAGES = ["fr", "en"] as const;
export const LEVELS = ["college", "lycee", "superieur"] as const;

const label = (max = 40) => z.string().min(1).max(max);
const lineStyle = z.enum(["solid", "dashed"]);

export const LAYOUT_SLOTS = {
  statement: ["text"],
  figure: ["figure"],
  "figure-notes": ["figure", "notes"],
  "formula-focus": ["formula", "figure", "readout"],
  compare: ["figure_a", "figure_b"],
  sequence: ["track"],
} as const;

export type LayoutName = keyof typeof LAYOUT_SLOTS;
export const LAYOUT_NAMES = Object.keys(LAYOUT_SLOTS) as [LayoutName, ...LayoutName[]];

export const SLOT_NAMES = [
  "text",
  "notes",
  "formula",
  "readout",
  "figure",
  "figure_a",
  "figure_b",
  "track",
] as const;
export type SlotName = (typeof SLOT_NAMES)[number];
const SlotSchema = z.enum(SLOT_NAMES).meta({ id: "Slot" });

const FIGURE_SLOTS = ["figure", "figure_a", "figure_b"] as const satisfies readonly SlotName[];

const base = { id: IdSchema, slot: SlotSchema };

const TextElement = z
  .strictObject({
    ...base,
    type: z.literal("text"),
    text: z.string().min(1).max(140).describe("May interpolate model values: {{F|sci:2}}."),
    emphasis: z.enum(["normal", "strong"]).optional(),
    role: ColourSchema.optional(),
  })
  .describe("A short sentence.");

const ListElement = z
  .strictObject({
    ...base,
    type: z.literal("list"),
    items: z.array(z.string().min(1).max(80)).min(1).max(4),
  })
  .describe("Up to four short points.");

const FormulaElement = z
  .strictObject({
    ...base,
    type: z.literal("formula"),
    tex: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "KaTeX source. Colour a symbol by its role with \\q{…} (quantity), \\a{…} (action), \\res{…} (result), \\ok{…} (valid). May interpolate model values.",
      ),
  })
  .describe("A typeset formula.");

const ReadoutElement = z
  .strictObject({
    ...base,
    type: z.literal("readout"),
    value: IdSchema.describe("Id of a parameter, constant or derived value."),
    label: label().optional(),
  })
  .describe("A live value of the model with its unit; updates when a slider moves.");

const AxesElement = z
  .strictObject({
    ...base,
    type: z.literal("axes"),
    xLabel: label(24).optional(),
    yLabel: label(24).optional(),
    xTicks: z.number().int().min(0).max(10).optional(),
    yTicks: z.number().int().min(0).max(10).optional(),
    grid: z.boolean().optional(),
  })
  .describe("Axes spanning the scene `world`.");

const PlotElement = z
  .strictObject({
    ...base,
    type: z.literal("plot"),
    fn: z
      .string()
      .min(1)
      .max(200)
      .describe('Expression in "x", for example "a * x^2". May read model values and time "t".'),
    domain: z.tuple([BindableSchema, BindableSchema]).optional(),
    role: ColourSchema.optional(),
    label: label().optional(),
    style: lineStyle.optional(),
  })
  .describe("The curve y = fn(x).");

const PointElement = z
  .strictObject({
    ...base,
    type: z.literal("point"),
    at: PointSchema,
    label: label().optional(),
    role: ColourSchema.optional(),
  })
  .describe("A marked point.");

const SegmentElement = z
  .strictObject({
    ...base,
    type: z.literal("segment"),
    from: AnchorSchema,
    to: AnchorSchema,
    label: label().optional(),
    role: ColourSchema.optional(),
    style: lineStyle.optional(),
  })
  .describe("A straight line between two points or elements.");

const VectorElement = z
  .strictObject({
    ...base,
    type: z.literal("vector"),
    from: AnchorSchema,
    to: AnchorSchema.optional().describe("End point. Use either `to`, or `toward` with `length`."),
    toward: AnchorSchema.optional().describe("Direction of the arrow."),
    length: BindableSchema.optional().describe("Length in world units, used with `toward`."),
    label: label().optional(),
    role: ColourSchema.optional(),
  })
  .describe("An arrow: a force, a velocity, a displacement.");

const DimensionElement = z
  .strictObject({
    ...base,
    type: z.literal("dimension"),
    from: AnchorSchema,
    to: AnchorSchema,
    label: label().optional(),
    role: ColourSchema.optional(),
    offset: z.number().min(-10).max(10).optional(),
  })
  .describe("A dimension line with extension lines, as on a technical drawing.");

const AngleElement = z
  .strictObject({
    ...base,
    type: z.literal("angle"),
    vertex: AnchorSchema,
    from: AnchorSchema,
    to: AnchorSchema,
    label: label().optional(),
    role: ColourSchema.optional(),
  })
  .describe("An angle arc at `vertex`, between the directions of `from` and `to`.");

const ShapeElement = z
  .strictObject({
    ...base,
    type: z.literal("shape"),
    kind: z.enum(["circle", "rect", "polygon", "arc"]),
    center: PointSchema.optional().describe("Centre, for circle, rect and arc."),
    radius: BindableSchema.optional().describe("For circle and arc."),
    width: BindableSchema.optional().describe("For rect."),
    height: BindableSchema.optional().describe("For rect."),
    points: z.array(PointSchema).min(3).max(8).optional().describe("For polygon."),
    startDeg: BindableSchema.optional().describe("For arc."),
    endDeg: BindableSchema.optional().describe("For arc."),
    fill: z.enum(["none", "hatch", ...ROLE_COLOURS]).optional(),
    role: ColourSchema.optional(),
    label: label().optional(),
  })
  .describe("A geometric outline, optionally filled with a role colour or hatching.");

const AreaElement = z
  .strictObject({
    ...base,
    type: z.literal("area"),
    plot: IdSchema.describe("Id of a plot element."),
    from: BindableSchema,
    to: BindableSchema,
    role: ColourSchema.optional(),
    label: label().optional(),
  })
  .describe("The area under a plot between two abscissas.");

const TangentElement = z
  .strictObject({
    ...base,
    type: z.literal("tangent"),
    plot: IdSchema.describe("Id of a plot element."),
    at: BindableSchema.describe("Abscissa of the point of tangency."),
    showSlope: z.boolean().optional(),
    label: label().optional(),
    role: ColourSchema.optional(),
  })
  .describe("The tangent to a plot at one point, with its slope.");

const ObjectElement = z
  .strictObject({
    ...base,
    type: z.literal("object"),
    kind: PictogramSchema,
    at: PointSchema,
    size: BindableSchema.describe("Height in world units."),
    label: label().optional(),
    role: ColourSchema.optional(),
  })
  .describe("A line-drawn pictogram from the closed library.");

const BarsElement = z
  .strictObject({
    ...base,
    type: z.literal("bars"),
    items: z
      .array(
        z.strictObject({ label: label(24), value: BindableSchema, role: ColourSchema.optional() }),
      )
      .min(2)
      .max(6),
    unit: z.string().max(16).optional(),
  })
  .describe("A bar chart; values are labelled directly.");

const TimelineElement = z
  .strictObject({
    ...base,
    type: z.literal("timeline"),
    events: z
      .array(
        z.strictObject({
          at: z.string().min(1).max(16).describe("Date or moment, as shown."),
          label: label(60),
          detail: z.string().max(100).optional(),
        }),
      )
      .min(2)
      .max(6),
  })
  .describe("A timeline of dated events. Part names: e1, e2, …");

const StepsElement = z
  .strictObject({
    ...base,
    type: z.literal("steps"),
    items: z
      .array(z.strictObject({ label: label(60), detail: z.string().max(100).optional() }))
      .min(2)
      .max(6),
  })
  .describe("Ordered steps. Part names: s1, s2, …");

const RelationsElement = z
  .strictObject({
    ...base,
    type: z.literal("relations"),
    nodes: z
      .array(z.strictObject({ id: IdSchema, label: label(30), role: ColourSchema.optional() }))
      .min(2)
      .max(7),
    edges: z
      .array(z.strictObject({ from: IdSchema, to: IdSchema, label: z.string().max(24).optional() }))
      .max(10),
  })
  .describe("A diagram of relations between notions. Part names are the node ids.");

const TableElement = z
  .strictObject({
    ...base,
    type: z.literal("table"),
    columns: z.array(label(24)).min(2).max(3),
    rows: z
      .array(z.array(z.string().max(60)).min(2).max(3))
      .min(1)
      .max(5),
  })
  .describe("A small comparison table.");

const SimTwoBody = z
  .strictObject({
    ...base,
    type: z.literal("sim.two-body"),
    massA: BindableSchema,
    massB: BindableSchema,
    distance: BindableSchema,
    force: BindableSchema.describe("The attraction, bound to a derived value."),
    objectA: PictogramSchema.optional(),
    objectB: PictogramSchema.optional(),
    labelA: label(24).optional(),
    labelB: label(24).optional(),
    forceLabel: label(8).optional(),
    distanceLabel: label(8).optional(),
  })
  .describe(
    "Two bodies attracting each other with equal and opposite forces. Parts: body_a, body_b, force_a, force_b, distance.",
  );

const SimFall = z
  .strictObject({
    ...base,
    type: z.literal("sim.fall"),
    height: BindableSchema.describe("Drop height, metres."),
    gravity: BindableSchema.describe("Acceleration, m/s²."),
    object: PictogramSchema.optional(),
    showVelocity: z.boolean().optional(),
  })
  .describe(
    "Free fall following ½·g·t². Driven by a `play` action. Parts: body, velocity, height, ground.",
  );

const SimOrbit = z
  .strictObject({
    ...base,
    type: z.literal("sim.orbit"),
    radius: BindableSchema,
    period: BindableSchema.describe("Time of one revolution."),
    center: PictogramSchema.optional(),
    body: PictogramSchema.optional(),
    showVelocity: z.boolean().optional(),
    showForce: z.boolean().optional(),
  })
  .describe(
    "Uniform circular motion. Driven by a `play` action. Parts: center, body, path, velocity, force, radius.",
  );

const SimPendulum = z
  .strictObject({
    ...base,
    type: z.literal("sim.pendulum"),
    length: BindableSchema.describe("Metres."),
    amplitude: BindableSchema.describe("Starting angle, degrees."),
    gravity: BindableSchema.optional(),
  })
  .describe("A simple pendulum. Driven by a `play` action. Parts: pivot, rod, bob, arc.");

const SimCircuit = z
  .strictObject({
    ...base,
    type: z.literal("sim.circuit"),
    voltage: BindableSchema,
    resistance: BindableSchema,
    current: BindableSchema.describe("Bound to a derived value such as U / R."),
  })
  .describe(
    "A source and a resistor; the flow of charge carriers shows the current. Parts: source, resistor, wire, carriers.",
  );

const SimWave = z
  .strictObject({
    ...base,
    type: z.literal("sim.wave"),
    amplitude: BindableSchema,
    frequency: BindableSchema,
    speed: BindableSchema.optional(),
  })
  .describe(
    "A travelling sine wave. Driven by a `play` action. Parts: wave, wavelength, amplitude.",
  );

const SimRightTriangle = z
  .strictObject({
    ...base,
    type: z.literal("sim.right-triangle"),
    a: BindableSchema,
    b: BindableSchema,
    showSquares: z.boolean().optional(),
    labelA: label(8).optional(),
    labelB: label(8).optional(),
    labelC: label(8).optional(),
  })
  .describe(
    "A right triangle with the squares built on its sides. Parts: triangle, side_a, side_b, side_c, square_a, square_b, square_c, right_angle.",
  );

const species = z.strictObject({
  formula: z
    .string()
    .regex(/^(?:[A-Z][a-z]?\d{0,2})+$/, "must be a plain chemical formula such as H2O or C6H12O6")
    .max(16),
  coefficient: BindableSchema,
});

const SimReaction = z
  .strictObject({
    ...base,
    type: z.literal("sim.reaction"),
    reactants: z.array(species).min(1).max(3),
    products: z.array(species).min(1).max(3),
  })
  .describe(
    "Molecules of the reactants rearranged into products, with an atom count on each side. Parts: reactants, products, arrow, tally.",
  );

const flowBranch = z.strictObject({
  id: IdSchema,
  label: label(24),
  rate: BindableSchema,
  role: ColourSchema.optional(),
});

const SimFlow = z
  .strictObject({
    ...base,
    type: z.literal("sim.flow"),
    node: z.strictObject({ label: label(24), object: PictogramSchema.optional() }),
    inputs: z.array(flowBranch).min(1).max(3),
    outputs: z.array(flowBranch).min(1).max(3),
  })
  .describe(
    "What enters and leaves a system (a leaf, a cell). Flow width follows each rate. Parts: node, and the id of each input and output.",
  );

const SimArray = z
  .strictObject({
    ...base,
    type: z.literal("sim.array"),
    values: z.array(z.number()).min(3).max(10),
    algorithm: z.enum(["bubble-sort", "selection-sort", "binary-search", "linear-search"]),
    target: z.number().optional().describe("Value searched for, for the search algorithms."),
    step: BindableSchema.optional().describe(
      "Step shown. Omit it and use a `play` action to advance.",
    ),
  })
  .describe(
    "An algorithm unfolding on an array, one comparison at a time. Parts: cells, compare, swap, low, high, mid, counter.",
  );

const SimMarket = z
  .strictObject({
    ...base,
    type: z.literal("sim.market"),
    demandShift: BindableSchema.describe("Shift of the demand curve; 0 is the starting position."),
    supplyShift: BindableSchema.describe("Shift of the supply curve; 0 is the starting position."),
    priceLabel: label(16).optional(),
    quantityLabel: label(16).optional(),
  })
  .describe(
    "Supply and demand curves and their equilibrium. Parts: demand, supply, equilibrium, price, quantity.",
  );

export const ElementSchema = z.discriminatedUnion("type", [
  TextElement,
  ListElement,
  FormulaElement,
  ReadoutElement,
  AxesElement,
  PlotElement,
  PointElement,
  SegmentElement,
  VectorElement,
  DimensionElement,
  AngleElement,
  ShapeElement,
  AreaElement,
  TangentElement,
  ObjectElement,
  BarsElement,
  TimelineElement,
  StepsElement,
  RelationsElement,
  TableElement,
  SimTwoBody,
  SimFall,
  SimOrbit,
  SimPendulum,
  SimCircuit,
  SimWave,
  SimRightTriangle,
  SimReaction,
  SimFlow,
  SimArray,
  SimMarket,
]);

export type SceneElement = z.infer<typeof ElementSchema>;
export type ElementType = SceneElement["type"];
export type ElementOf<T extends ElementType> = Extract<SceneElement, { type: T }>;

export const ELEMENT_TYPES = ElementSchema.options.map(
  (option) => option.shape.type.value,
) as ElementType[];

export const ELEMENT_SLOTS: Readonly<Record<ElementType, readonly SlotName[]>> = {
  text: ["text", "notes"],
  list: ["text", "notes"],
  formula: ["formula", "notes"],
  readout: ["readout", "notes"],
  axes: FIGURE_SLOTS,
  plot: FIGURE_SLOTS,
  point: FIGURE_SLOTS,
  segment: FIGURE_SLOTS,
  vector: FIGURE_SLOTS,
  dimension: FIGURE_SLOTS,
  angle: FIGURE_SLOTS,
  shape: FIGURE_SLOTS,
  area: FIGURE_SLOTS,
  tangent: FIGURE_SLOTS,
  object: FIGURE_SLOTS,
  bars: FIGURE_SLOTS,
  timeline: ["track"],
  steps: ["track", "notes"],
  relations: FIGURE_SLOTS,
  table: [...FIGURE_SLOTS, "notes"],
  "sim.two-body": FIGURE_SLOTS,
  "sim.fall": FIGURE_SLOTS,
  "sim.orbit": FIGURE_SLOTS,
  "sim.pendulum": FIGURE_SLOTS,
  "sim.circuit": FIGURE_SLOTS,
  "sim.wave": FIGURE_SLOTS,
  "sim.right-triangle": FIGURE_SLOTS,
  "sim.reaction": FIGURE_SLOTS,
  "sim.flow": FIGURE_SLOTS,
  "sim.array": FIGURE_SLOTS,
  "sim.market": FIGURE_SLOTS,
};

export const WORLD_ELEMENT_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  "axes",
  "plot",
  "point",
  "segment",
  "vector",
  "dimension",
  "angle",
  "shape",
  "area",
  "tangent",
  "object",
]);

export const BLOCK_ELEMENT_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(
  ELEMENT_TYPES.filter(
    (type) =>
      type.startsWith("sim.") || ["bars", "timeline", "steps", "relations", "table"].includes(type),
  ),
);

export const ELEMENT_PARTS: Readonly<Partial<Record<ElementType, readonly string[]>>> = {
  "sim.two-body": ["body_a", "body_b", "force_a", "force_b", "distance"],
  "sim.fall": ["body", "velocity", "height", "ground"],
  "sim.orbit": ["center", "body", "path", "velocity", "force", "radius"],
  "sim.pendulum": ["pivot", "rod", "bob", "arc"],
  "sim.circuit": ["source", "resistor", "wire", "carriers"],
  "sim.wave": ["wave", "wavelength", "amplitude"],
  "sim.right-triangle": [
    "triangle",
    "side_a",
    "side_b",
    "side_c",
    "square_a",
    "square_b",
    "square_c",
    "right_angle",
  ],
  "sim.reaction": ["reactants", "products", "arrow", "tally"],
  "sim.array": ["cells", "compare", "swap", "low", "high", "mid", "counter"],
  "sim.market": ["demand", "supply", "equilibrium", "price", "quantity"],
};

export const PLAYABLE_ELEMENT_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  "plot",
  "sim.fall",
  "sim.orbit",
  "sim.pendulum",
  "sim.wave",
  "sim.array",
]);

const at = z
  .number()
  .min(0)
  .max(1)
  .optional()
  .describe("When the action starts, as a fraction of the beat. Omit to spread actions evenly.");

const targets = z.array(TargetSchema).min(1).max(6);

export const ActionSchema = z.discriminatedUnion("do", [
  z
    .strictObject({
      do: z.literal("show"),
      targets,
      how: z.enum(["fade", "draw", "type"]).optional(),
      at,
    })
    .describe('Make elements appear. "draw" traces lines, "type" sets text, "fade" for the rest.'),
  z.strictObject({ do: z.literal("hide"), targets, at }).describe("Make elements disappear."),
  z
    .strictObject({ do: z.literal("highlight"), targets, at })
    .describe("Mark as the thing to remember (highlighter)."),
  z
    .strictObject({ do: z.literal("focus"), targets, at })
    .describe("Dim everything else until the end of the beat."),
  z
    .strictObject({ do: z.literal("move"), target: IdSchema, to: PointSchema, at })
    .describe("Move an element inside the frame."),
  z
    .strictObject({
      do: z.literal("sweep"),
      param: IdSchema.describe("Id of a parameter."),
      to: BindableSchema,
      hold: z
        .boolean()
        .optional()
        .describe("Keep the new value instead of returning to the start."),
      at,
    })
    .describe("Vary a parameter during the beat, as if moving its slider, so the figure reacts."),
  z
    .strictObject({
      do: z.literal("play"),
      target: IdSchema,
      from: z.number().min(0).optional(),
      to: z.number().positive().describe("Simulated seconds, or steps for an algorithm."),
      at,
    })
    .describe("Run a simulation forward."),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionKind = Action["do"];

export const AudioSchema = z.strictObject({
  url: z.string().min(1).max(300),
  duration_ms: z.number().int().positive().max(60_000),
});

export const BeatSchema = z.strictObject({
  id: IdSchema,
  narration: z
    .string()
    .min(1)
    .max(200)
    .describe("One sentence, spoken and shown as a subtitle. Say what the eye should look at."),
  actions: z.array(ActionSchema).max(6).default([]),
  audio: AudioSchema.optional().describe("Added by the pipeline, never by the author."),
  duration_ms: z.number().int().positive().max(60_000).optional(),
});

export type Beat = z.infer<typeof BeatSchema>;

export const SCENE_ROLES = ["hook", "analogy", "mechanism", "formula", "example", "recap"] as const;
export const SceneRoleSchema = z.enum(SCENE_ROLES);
export type SceneRole = (typeof SCENE_ROLES)[number];

const range = z
  .tuple([z.number(), z.number()])
  .refine(([min, max]) => min < max, "the first value must be lower than the second");

export const WorldSchema = z
  .strictObject({ x: range, y: range })
  .describe(
    "Mathematical frame of the figure; the engine fits it into the slot without distortion.",
  );

export const SceneSchema = z.strictObject({
  id: IdSchema,
  index: z.number().int().min(0).max(6),
  role: SceneRoleSchema,
  title: z.string().min(1).max(60).describe("Figure caption; shown in the title area."),
  layout: z.enum(LAYOUT_NAMES),
  world: WorldSchema.optional(),
  elements: z.array(ElementSchema).min(1).max(14),
  beats: z.array(BeatSchema).min(1).max(6),
  duration_ms: z.number().int().positive().optional(),
});

export type Scene = z.infer<typeof SceneSchema>;

export const PlanSchema = z.strictObject({
  objective: z
    .string()
    .min(1)
    .max(200)
    .describe("What the student will know at the end, in one sentence."),
  prerequisites: z.array(z.string().min(1).max(100)).max(4),
  analogy: z.strictObject({
    name: z.string().min(1).max(60).describe("Short name, used to avoid repeating an analogy."),
    mapping: z.string().min(1).max(300).describe("What stands for what."),
  }),
  key_rule: z.strictObject({
    statement: z.string().min(1).max(240),
    formula: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("KaTeX source; omit if the concept has no formula."),
  }),
  steps: z
    .array(
      z.strictObject({
        role: SceneRoleSchema,
        intent: z
          .string()
          .min(1)
          .max(200)
          .describe("What this scene must make the student understand."),
        visual: z.string().min(1).max(200).describe("What is drawn."),
      }),
    )
    .min(1)
    .max(7),
});

export type Plan = z.infer<typeof PlanSchema>;

export const ParamSchema = z.strictObject({
  id: IdSchema,
  symbol: z.string().min(1).max(8).describe("As printed, for example m₁."),
  label: label(40),
  unit: z.string().max(16).default(""),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  default: z.number(),
  role: z.literal("quantity").default("quantity"),
});

export type Param = z.infer<typeof ParamSchema>;

export const ConstantSchema = z.strictObject({
  id: IdSchema,
  value: z.number(),
  unit: z.string().max(16).default(""),
  label: label(60),
  symbol: z.string().min(1).max(8).optional(),
});

export const DerivedSchema = z.strictObject({
  id: IdSchema,
  expr: z
    .string()
    .min(1)
    .max(200)
    .describe("Reads parameters, constants and derived values declared before it."),
  unit: z.string().max(16).default(""),
  label: label(60),
  symbol: z.string().min(1).max(8).optional(),
  format: z
    .string()
    .regex(
      /^(int|(fixed|sig|sci|percent):\d{1,2})$/,
      'must be "int", "fixed:n", "sig:n", "sci:n" or "percent:n"',
    )
    .optional(),
});

export const ModelSchema = z.strictObject({
  constants: z.array(ConstantSchema).max(6).default([]),
  derived: z.array(DerivedSchema).max(8).default([]),
});

export type Model = z.infer<typeof ModelSchema>;

export const QuizQuestionSchema = z.strictObject({
  prompt: z.string().min(1).max(240),
  choices: z
    .array(z.strictObject({ id: IdSchema, text: z.string().min(1).max(120) }))
    .min(3)
    .max(4),
  answer_id: IdSchema,
  explanation: z.string().min(1).max(240).describe("One sentence saying why."),
  scene_id: IdSchema.describe("The scene that covers this point."),
});

export const QuizSchema = z.strictObject({
  questions: z.array(QuizQuestionSchema).min(2).max(3),
});

export type Quiz = z.infer<typeof QuizSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const DocumentSchema = z.strictObject({
  version: z.literal(SCHEMA_VERSION),
  plan: PlanSchema,
  params: z.array(ParamSchema).max(4).default([]),
  model: ModelSchema.default({ constants: [], derived: [] }),
  scenes: z.array(SceneSchema).min(1).max(7),
  quiz: QuizSchema.optional(),
});

export type ExplanationDocument = z.infer<typeof DocumentSchema>;

export const OutlineSchema = DocumentSchema.pick({ plan: true, params: true, model: true });
export type Outline = z.infer<typeof OutlineSchema>;

export type Level = (typeof LEVELS)[number];
