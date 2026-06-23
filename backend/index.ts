// =====================================================================
// DRESSING ROOM — by Basil Metric
// Cloudflare Worker (Hono) — backend/index.ts
// =====================================================================
// Routes:
//   POST /api/users                       register a person, store birth metadata
//   GET  /api/users/:id                    fetch stored profile
//   GET  /api/users/:id/today              today's full directive
//   GET  /api/users/:id/date/:date         directive for any specific YYYY-MM-DD date
//   GET  /api/users/:id/forecast?days=7    directive for the next N days (default 7, max 14)
//
// Bindings expected in wrangler.toml:
//   DB                       -> D1Database
//   ASTROLOGY_API_HOST       -> string, e.g. astrologer.p.rapidapi.com
//   ASTROLOGY_API_KEY        -> string, secret — RapidAPI key
//
// Astrology provider: Astrologer API (Kerykeion engine), via RapidAPI.
// Docs: https://kerykeion.net/astrologer-api/docs/v5/data/subject
// =====================================================================

import { Hono } from "hono";
import { cors } from "hono/cors";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

type Bindings = {
  DB: D1Database;
  ASTROLOGY_API_HOST: string;
  ASTROLOGY_API_KEY: string;
};

interface RegisterBody {
  name: string;
  birth_date: string; // YYYY-MM-DD
  birth_time: string; // HH:MM, 24h
  birth_place: string;
  lat: number;
  lon: number;
  timezone: string; // IANA tz name, e.g. "Asia/Bangkok"
}

interface UserRow {
  id: string;
  name: string;
  birth_date: string;
  birth_time: string;
  birth_place: string;
  lat: number;
  lon: number;
  timezone: string;
  created_at: string;
}

interface DailyStateRow {
  id: string;
  user_id: string;
  state_date: string;
  dominant_element: string;
  element_balance: string;
  transit_summary: string;
  vibe_text: string;
  hair_directive: "up" | "down";
  work_hex: string;
  work_name: string;
  charm_hex: string;
  charm_name: string;
  health_hex: string;
  health_name: string;
  avoid_hex: string;
  avoid_name: string;
  created_at: string;
}

type ElementBalance = { fire: number; air: number; earth: number; water: number };
type ElementKey = keyof ElementBalance;

type ColorCategory = { hex: string; name: string };

type DailyStatePayload = {
  date: string;
  vibe: { text: string };
  colors: {
    work: ColorCategory;
    charm: ColorCategory;
    health: ColorCategory;
    avoid: ColorCategory;
  };
  hair: { directive: "up" | "down"; label: string };
  dominantElement: string;
  elementBalance: ElementBalance;
  thai: {
    dayName: string;
    color: ColorCategory;
    avoid: ColorCategory;
    note: string;
  };
  cached: boolean;
};

// ---------------------------------------------------------------------
// Planet weighting
// ---------------------------------------------------------------------

// The Astrologer API returns an `element` field directly on each planet
// object (Fire/Air/Earth/Water), so no sign-to-element lookup is needed.

// Planets weighted by how strongly they shape a single day's mood/styling.
// Faster-moving bodies dominate daily texture more than outer planets.
const PLANET_WEIGHT: Record<string, number> = {
  Moon: 3,
  Sun: 2.5,
  Mercury: 2,
  Venus: 2,
  Mars: 1.5,
  Jupiter: 1,
  Saturn: 1,
};

// ---------------------------------------------------------------------
// Colour palettes, one per element, one per category
// ---------------------------------------------------------------------
// Each category reads a different facet of the day's chart:
//   work    <- the dominant element overall (the day's general character)
//   charm   <- skewed toward Air/Fire (sociability, expressiveness)
//   health  <- skewed toward Earth/Water (grounding, restoration)
//   avoid   <- the weakest element in the day's balance (what's least
//              supported today, so wearing it would work against the grain)
// All palettes stay within the monochrome-leaning editorial system —
// named neutrals with one considered colour per element as the accent.

const ELEMENT_PALETTE: Record<ElementKey, ColorCategory[]> = {
  fire: [
    { hex: "#7A2E1D", name: "Burnt Sienna" },
    { hex: "#1A1A1A", name: "Onyx" },
    { hex: "#A14E2A", name: "Rust" },
  ],
  air: [
    { hex: "#C7C2B8", name: "Bone" },
    { hex: "#5C6770", name: "Slate" },
    { hex: "#E8E4DA", name: "Chalk" },
  ],
  earth: [
    { hex: "#3D3A34", name: "Umber" },
    { hex: "#54483A", name: "Walnut" },
    { hex: "#2B2B2B", name: "Graphite" },
  ],
  water: [
    { hex: "#1F2A30", name: "Deep Tide" },
    { hex: "#39474D", name: "Wet Slate" },
    { hex: "#10151A", name: "Ink" },
  ],
};

// Dry, editorial vibe lines, indexed by dominant element.
// Short, declarative, no exclamation marks, no emojis -- reads like a stylist's note.
const VIBE_LINES: Record<ElementKey, string[]> = {
  fire: [
    "Move first, explain later. The day rewards decisiveness over politeness.",
    "Sharp angles suit you today. Save the soft edges for tomorrow.",
    "You will want the last word. Take it, but make it short.",
  ],
  air: [
    "Conversation is the main event. Dress like you might be photographed mid-sentence.",
    "Plans will change twice before lunch. Build in room to pivot.",
    "Today favours the observer. Watch first, commit second.",
  ],
  earth: [
    "Slow is the correct pace. Anything rushed will need redoing.",
    "Today is for finishing, not starting. Close one open loop.",
    "Comfort is not laziness today -- it is strategy.",
  ],
  water: [
    "Keep some things unspoken. Not everything needs an answer right now.",
    "Trust the quiet read on a person before the loud one.",
    "An old feeling resurfaces. Let it pass through, don't unpack it.",
  ],
};

// ---------------------------------------------------------------------
// Thai birth-day colour table (สีประจำวันเกิด) — traditional reference
// ---------------------------------------------------------------------
// IMPORTANT HONESTY NOTE: Thai birth-day colour belief is oral/temple
// tradition, not a single codified standard. Different sources (general
// lifestyle media vs. the more formal Thaksapakorn astrological system)
// give different answers, especially for "avoid" colours. The table below
// reflects the version most consistently repeated across general Thai
// lifestyle sources (the same one widely cited in popular references). It
// is presented to users as "a traditional reference," not as the single
// definitive answer — see the `note` field, surfaced directly in the UI.
//
// Keyed by JS Date.getDay(): 0=Sunday ... 6=Saturday.
type ThaiDayColor = { hex: string; name: string; avoidHex: string; avoidName: string };

const THAI_DAY_COLORS: Record<number, ThaiDayColor> = {
  0: { hex: "#FF8C00", name: "Orange (red-orange)", avoidHex: "#1F3B73", avoidName: "Blue" }, // Sunday
  1: { hex: "#F7E967", name: "Yellow", avoidHex: "#A8332B", avoidName: "Red" }, // Monday
  2: { hex: "#F4A6C1", name: "Pink", avoidHex: "#E8E4DA", avoidName: "White" }, // Tuesday
  3: { hex: "#4F9D55", name: "Green", avoidHex: "#D98BB0", avoidName: "Pink" }, // Wednesday
  4: { hex: "#E0801F", name: "Orange", avoidHex: "#1A1A1A", avoidName: "Black" }, // Thursday
  5: { hex: "#3D6FB4", name: "Blue", avoidHex: "#6B6B6B", avoidName: "Grey" }, // Friday
  6: { hex: "#4B3A6E", name: "Purple", avoidHex: "#3D5A3D", avoidName: "Green" }, // Saturday
};

const THAI_DAY_NAMES: Record<number, string> = {
  0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
  4: "Thursday", 5: "Friday", 6: "Saturday",
};

const THAI_REFERENCE_NOTE =
  "Traditional Thai birth-day colour belief varies by source and region. This reflects a commonly cited popular version, not a single official standard.";

/** Day-of-week index (0=Sunday) for a YYYY-MM-DD date string, independent of timezone math (pure calendar lookup). */
function weekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function thaiColorForDate(dateStr: string): {
  dayName: string;
  color: { hex: string; name: string };
  avoid: { hex: string; name: string };
  note: string;
} {
  const idx = weekdayIndex(dateStr);
  const entry = THAI_DAY_COLORS[idx];
  return {
    dayName: THAI_DAY_NAMES[idx],
    color: { hex: entry.hex, name: entry.name },
    avoid: { hex: entry.avoidHex, name: entry.avoidName },
    note: THAI_REFERENCE_NOTE,
  };
}



function uuid(): string {
  return crypto.randomUUID();
}

/** Local calendar date string (YYYY-MM-DD) for a given IANA timezone. */
function localDateInTimezone(timezone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds N days to a YYYY-MM-DD date string, returning a new YYYY-MM-DD string. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function pick<T>(arr: T[], seed: number): T {
  const idx = Math.abs(Math.floor(seed)) % arr.length;
  return arr[idx];
}

/** Deterministic pseudo-random seed from a string, so the same day always
 *  resolves to the same pick if recomputed (stable, not actually random). */
function seedFromString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Calls the Astrologer API (Kerykeion engine, hosted on RapidAPI) for
 * the given target date's planetary positions at the user's coordinates,
 * returning a simplified planet -> element list.
 *
 * Endpoint: POST https://{ASTROLOGY_API_HOST}/api/v5/subject
 * Docs: https://kerykeion.net/astrologer-api/docs/v5/data/subject
 *
 * targetDate is a YYYY-MM-DD string in the user's local calendar. We pass
 * noon local time on that date with the user's lat/lon/timezone as the
 * "subject" — this gives us that day's sky as seen from the user's location,
 * which is what the daily directive is meant to reflect. Noon is used as a
 * stable reference point so the computed elements don't shift hour-to-hour
 * within the same calendar day.
 */
async function fetchTransitPlacements(
  env: Bindings,
  user: UserRow,
  targetDate: string
): Promise<{ planet: string; element: string }[]> {
  const [year, month, day] = targetDate.split("-").map(Number);

  const requestBody = {
    subject: {
      name: "Daily Transit",
      year,
      month,
      day,
      hour: 12,
      minute: 0,
      city: user.birth_place,
      nation: "TH",
      longitude: user.lon,
      latitude: user.lat,
      timezone: user.timezone,
      zodiac_type: "Tropical",
      houses_system_identifier: "P",
    },
  };

  const res = await fetch(`https://${env.ASTROLOGY_API_HOST}/api/v5/subject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": env.ASTROLOGY_API_HOST,
      "x-rapidapi-key": env.ASTROLOGY_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`astrology feed responded ${res.status}: ${errorText}`);
  }

  const data: any = await res.json();
  const subject = data?.subject;
  if (!subject) {
    throw new Error("astrology feed returned no subject data");
  }

  // The planets we care about for daily styling — fast-moving, mood-shaping bodies.
  const planetKeys = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];

  return planetKeys
    .map((key) => {
      const planetData = subject[key];
      if (!planetData?.element) return null;
      return { planet: planetData.name ?? key, element: String(planetData.element) };
    })
    .filter((x): x is { planet: string; element: string } => x !== null);
}

/** Turns raw planet/element placements into a normalized 0-1 element balance. */
function computeElementBalance(
  placements: { planet: string; element: string }[]
): ElementBalance {
  const totals: ElementBalance = { fire: 0, air: 0, earth: 0, water: 0 };

  for (const { planet, element } of placements) {
    const key = element.toLowerCase() as ElementKey;
    if (!(key in totals)) continue;
    const weight = PLANET_WEIGHT[planet] ?? 0.5;
    totals[key] += weight;
  }

  const sum = totals.fire + totals.air + totals.earth + totals.water;
  if (sum === 0) {
    // Upstream feed returned nothing usable -- fall back to an even split
    // rather than dividing by zero, so the UI still renders something coherent.
    return { fire: 0.25, air: 0.25, earth: 0.25, water: 0.25 };
  }

  return {
    fire: totals.fire / sum,
    air: totals.air / sum,
    earth: totals.earth / sum,
    water: totals.water / sum,
  };
}

function dominantElement(balance: ElementBalance): ElementKey {
  return (Object.keys(balance) as ElementKey[]).reduce((a, b) =>
    balance[a] >= balance[b] ? a : b
  );
}

function weakestElement(balance: ElementBalance): ElementKey {
  return (Object.keys(balance) as ElementKey[]).reduce((a, b) =>
    balance[a] <= balance[b] ? a : b
  );
}

/** Hair directive: Fire/Air (expressive, kinetic) -> Hair Up. Earth/Water (grounded, soft) -> Hair Down. */
function computeHairDirective(balance: ElementBalance): "up" | "down" {
  const kinetic = balance.fire + balance.air;
  const grounded = balance.earth + balance.water;
  return kinetic >= grounded ? "up" : "down";
}

/**
 * Picks the element that best represents a category for the day:
 *   work   -> the day's overall dominant element (general character)
 *   charm  -> whichever of Air/Fire is stronger today (sociability, spark)
 *   health -> whichever of Earth/Water is stronger today (grounding, ease)
 *   avoid  -> the day's weakest element (least supported, works against the grain)
 */
function categoryElements(balance: ElementBalance): {
  work: ElementKey;
  charm: ElementKey;
  health: ElementKey;
  avoid: ElementKey;
} {
  const charm: ElementKey = balance.air >= balance.fire ? "air" : "fire";
  const health: ElementKey = balance.earth >= balance.water ? "earth" : "water";

  return {
    work: dominantElement(balance),
    charm,
    health,
    avoid: weakestElement(balance),
  };
}

function buildDailyPayload(
  userId: string,
  stateDate: string,
  balance: ElementBalance,
  transitPlacements: { planet: string; element: string }[]
): Omit<DailyStateRow, "id" | "created_at"> {
  const dominant = dominantElement(balance);
  const seed = seedFromString(`${userId}:${stateDate}`);

  const vibeText = pick(VIBE_LINES[dominant], seed);
  const hair = computeHairDirective(balance);
  const categories = categoryElements(balance);

  // Offset the seed per category so the same element doesn't always pick
  // the same shade across categories that happen to share an element.
  const work = pick(ELEMENT_PALETTE[categories.work], seed + 1);
  const charm = pick(ELEMENT_PALETTE[categories.charm], seed + 11);
  const health = pick(ELEMENT_PALETTE[categories.health], seed + 23);
  const avoid = pick(ELEMENT_PALETTE[categories.avoid], seed + 37);

  return {
    user_id: userId,
    state_date: stateDate,
    dominant_element: dominant,
    element_balance: JSON.stringify(balance),
    transit_summary: JSON.stringify(transitPlacements),
    vibe_text: vibeText,
    hair_directive: hair,
    work_hex: work.hex,
    work_name: work.name,
    charm_hex: charm.hex,
    charm_name: charm.name,
    health_hex: health.hex,
    health_name: health.name,
    avoid_hex: avoid.hex,
    avoid_name: avoid.name,
  };
}

function rowToPayload(row: DailyStateRow): DailyStatePayload {
  return {
    date: row.state_date,
    vibe: { text: row.vibe_text },
    colors: {
      work: { hex: row.work_hex, name: row.work_name },
      charm: { hex: row.charm_hex, name: row.charm_name },
      health: { hex: row.health_hex, name: row.health_name },
      avoid: { hex: row.avoid_hex, name: row.avoid_name },
    },
    hair: {
      directive: row.hair_directive,
      label: row.hair_directive === "up" ? "Hair Up" : "Hair Down",
    },
    dominantElement: row.dominant_element,
    elementBalance: JSON.parse(row.element_balance),
    thai: thaiColorForDate(row.state_date),
    cached: true,
  };
}

/**
 * Core cache-or-compute routine shared by /today, /date/:date, and /forecast.
 * Checks daily_states for an existing row for (user, targetDate); if absent,
 * calls the astrology feed, computes the directive, caches it, and returns it.
 */
async function getOrComputeState(
  env: Bindings,
  user: UserRow,
  targetDate: string
): Promise<DailyStatePayload> {
  const cached = await env.DB.prepare(
    `SELECT * FROM daily_states WHERE user_id = ? AND state_date = ?`
  )
    .bind(user.id, targetDate)
    .first<DailyStateRow>();

  if (cached) {
    return rowToPayload(cached);
  }

  const placements = await fetchTransitPlacements(env, user, targetDate);
  const balance = computeElementBalance(placements);
  const newState = buildDailyPayload(user.id, targetDate, balance, placements);
  const newId = uuid();

  await env.DB.prepare(
    `INSERT INTO daily_states
      (id, user_id, state_date, dominant_element, element_balance, transit_summary,
       vibe_text, hair_directive, work_hex, work_name, charm_hex, charm_name,
       health_hex, health_name, avoid_hex, avoid_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, state_date) DO NOTHING`
  )
    .bind(
      newId,
      newState.user_id,
      newState.state_date,
      newState.dominant_element,
      newState.element_balance,
      newState.transit_summary,
      newState.vibe_text,
      newState.hair_directive,
      newState.work_hex,
      newState.work_name,
      newState.charm_hex,
      newState.charm_name,
      newState.health_hex,
      newState.health_name,
      newState.avoid_hex,
      newState.avoid_name
    )
    .run();

  return {
    date: newState.state_date,
    vibe: { text: newState.vibe_text },
    colors: {
      work: { hex: newState.work_hex, name: newState.work_name },
      charm: { hex: newState.charm_hex, name: newState.charm_name },
      health: { hex: newState.health_hex, name: newState.health_name },
      avoid: { hex: newState.avoid_hex, name: newState.avoid_name },
    },
    hair: {
      directive: newState.hair_directive,
      label: newState.hair_directive === "up" ? "Hair Up" : "Hair Down",
    },
    dominantElement: newState.dominant_element,
    elementBalance: balance,
    thai: thaiColorForDate(newState.state_date),
    cached: false,
  };
}

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.get("/api/health", (c) => c.json({ ok: true, service: "dressing-room-worker" }));

// ---- POST /api/users ---------------------------------------------------
app.post("/api/users", async (c) => {
  let body: RegisterBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON." }, 400);
  }

  const required: (keyof RegisterBody)[] = [
    "name",
    "birth_date",
    "birth_time",
    "birth_place",
    "lat",
    "lon",
    "timezone",
  ];
  const missing = required.filter(
    (key) => body[key] === undefined || body[key] === null || body[key] === ("" as any)
  );
  if (missing.length > 0) {
    return c.json({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
  }

  if (typeof body.lat !== "number" || typeof body.lon !== "number") {
    return c.json({ error: "lat and lon must be numbers." }, 400);
  }
  if (body.lat < -90 || body.lat > 90 || body.lon < -180 || body.lon > 180) {
    return c.json({ error: "lat/lon out of valid range." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.birth_date)) {
    return c.json({ error: "birth_date must be in YYYY-MM-DD format." }, 400);
  }
  if (!/^\d{2}:\d{2}$/.test(body.birth_time)) {
    return c.json({ error: "birth_time must be in HH:MM 24-hour format." }, 400);
  }

  const id = uuid();

  try {
    await c.env.DB.prepare(
      `INSERT INTO users (id, name, birth_date, birth_time, birth_place, lat, lon, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.name,
        body.birth_date,
        body.birth_time,
        body.birth_place,
        body.lat,
        body.lon,
        body.timezone
      )
      .run();
  } catch (err) {
    return c.json({ error: "Failed to create user.", detail: String(err) }, 500);
  }

  return c.json(
    {
      id,
      name: body.name,
      birth_place: body.birth_place,
      birthDayThai: thaiColorForDate(body.birth_date),
    },
    201
  );
});

// ---- GET /api/users/:id -------------------------------------------------
app.get("/api/users/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!row) return c.json({ error: "User not found." }, 404);

  // Birth-day colour is fixed for life — derived once from their birth date's
  // weekday, same traditional reference table used for "today's" colour.
  const birthDayThai = thaiColorForDate(row.birth_date);

  return c.json({ ...row, birthDayThai });
});

// ---- GET /api/users/:id/today -------------------------------------------
app.get("/api/users/:id/today", async (c) => {
  const id = c.req.param("id");

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!user) return c.json({ error: "User not found." }, 404);

  const stateDate = localDateInTimezone(user.timezone);

  try {
    const payload = await getOrComputeState(c.env, user, stateDate);
    return c.json(payload);
  } catch (err) {
    return c.json(
      { error: "Could not reach astrology data feed.", detail: String(err) },
      502
    );
  }
});

// ---- GET /api/users/:id/date/:date --------------------------------------
// Directive for any specific calendar date (past, today, or future).
app.get("/api/users/:id/date/:date", async (c) => {
  const id = c.req.param("id");
  const date = c.req.param("date");

  if (!isValidDateString(date)) {
    return c.json({ error: "date must be in YYYY-MM-DD format." }, 400);
  }

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!user) return c.json({ error: "User not found." }, 404);

  try {
    const payload = await getOrComputeState(c.env, user, date);
    return c.json(payload);
  } catch (err) {
    return c.json(
      { error: "Could not reach astrology data feed.", detail: String(err) },
      502
    );
  }
});

// ---- GET /api/users/:id/forecast?days=7 ---------------------------------
// Directives for the next N days starting from today (in the user's local
// timezone), inclusive of today. Computes/caches each day individually via
// getOrComputeState, then also returns a simple weekly overview computed
// by averaging the element balances across the returned days.
app.get("/api/users/:id/forecast", async (c) => {
  const id = c.req.param("id");
  const daysParam = c.req.query("days");
  const days = Math.min(Math.max(parseInt(daysParam ?? "7", 10) || 7, 1), 14);

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!user) return c.json({ error: "User not found." }, 404);

  const startDate = localDateInTimezone(user.timezone);
  const dates = Array.from({ length: days }, (_, i) => addDays(startDate, i));

  const results: DailyStatePayload[] = [];
  for (const date of dates) {
    try {
      const payload = await getOrComputeState(c.env, user, date);
      results.push(payload);
    } catch (err) {
      return c.json(
        {
          error: "Could not reach astrology data feed.",
          detail: String(err),
          partial: results,
        },
        502
      );
    }
  }

  // Weekly overview: average element balance across the returned days,
  // then run the same category/hair logic against that averaged balance
  // so the overview reads as a coherent single "week ahead" snapshot.
  const avgBalance: ElementBalance = results.reduce(
    (acc, r) => ({
      fire: acc.fire + r.elementBalance.fire / results.length,
      air: acc.air + r.elementBalance.air / results.length,
      earth: acc.earth + r.elementBalance.earth / results.length,
      water: acc.water + r.elementBalance.water / results.length,
    }),
    { fire: 0, air: 0, earth: 0, water: 0 }
  );

  const overviewSeed = seedFromString(`${id}:overview:${startDate}`);
  const overviewDominant = dominantElement(avgBalance);
  const overviewCategories = categoryElements(avgBalance);

  const overview = {
    startDate,
    endDate: dates[dates.length - 1],
    dominantElement: overviewDominant,
    elementBalance: avgBalance,
    vibe: { text: pick(VIBE_LINES[overviewDominant], overviewSeed) },
    hair: {
      directive: computeHairDirective(avgBalance),
      label: computeHairDirective(avgBalance) === "up" ? "Hair Up" : "Hair Down",
    },
    colors: {
      work: pick(ELEMENT_PALETTE[overviewCategories.work], overviewSeed + 1),
      charm: pick(ELEMENT_PALETTE[overviewCategories.charm], overviewSeed + 11),
      health: pick(ELEMENT_PALETTE[overviewCategories.health], overviewSeed + 23),
      avoid: pick(ELEMENT_PALETTE[overviewCategories.avoid], overviewSeed + 37),
    },
  };

  return c.json({ overview, days: results });
});

export default app;
