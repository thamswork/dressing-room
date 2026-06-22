"use client";

/**
 * Monochrome vector components for Dressing Room.
 * No raster assets, no gradients, no shadows — line weight and
 * orientation carry all the meaning.
 */

/** The garment tag — the signature mark of the app.
 *  Rotates to point up or down depending on the day's hair directive. */
export function GarmentTag({
  direction,
  size = 56,
}: {
  direction: "up" | "down";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        transform: direction === "down" ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      aria-hidden="true"
    >
      <path
        d="M28 3 L50 25 V50 H6 V25 Z"
        stroke="#F5F3EE"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="28" cy="14" r="2.4" stroke="#F5F3EE" strokeWidth="1.1" fill="none" />
      <line x1="14" y1="50" x2="14" y2="34" stroke="#F5F3EE" strokeWidth="1" />
      <line x1="42" y1="50" x2="42" y2="34" stroke="#F5F3EE" strokeWidth="1" />
    </svg>
  );
}

/** A flat geometric swatch for the lucky outfit colour — no glow, no bevel. */
export function ColorSwatch({ hex, size = 88 }: { hex: string; size?: number }) {
  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Colour swatch ${hex}`}
    >
      <svg width={size} height={size} viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg">
        <rect x="0.5" y="0.5" width="87" height="87" fill={hex} stroke="#2A2926" strokeWidth="1" />
        <line x1="0" y1="0" x2="88" y2="88" stroke="#0A0A0A" strokeOpacity="0.08" strokeWidth="0.6" />
      </svg>
    </div>
  );
}

/** Line-art glyph distinguishing Hair Up vs Hair Down — drawn, not iconographic. */
export function HairGlyph({ direction, size = 40 }: { direction: "up" | "down"; size?: number }) {
  if (direction === "up") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          d="M14 30 C14 18 16 9 20 9 C24 9 26 18 26 30"
          stroke="#F5F3EE"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <path d="M20 9 V4" stroke="#F5F3EE" strokeWidth="1.1" strokeLinecap="round" />
        <circle cx="20" cy="9" r="1.6" fill="#F5F3EE" />
        <path d="M16 30 H24" stroke="#F5F3EE" strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M13 8 C11 18 11 28 14 34"
        stroke="#F5F3EE"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M27 8 C29 18 29 28 26 34"
        stroke="#F5F3EE"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path d="M13 8 C16 5 24 5 27 8" stroke="#F5F3EE" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** Minimal four-point compass showing element balance — Fire/Air/Earth/Water. */
export function ElementCompass({
  balance,
  size = 120,
}: {
  balance: { fire: number; air: number; earth: number; water: number };
  size?: number;
}) {
  const cx = 60;
  const cy = 60;
  const maxR = 46;
  const points: [number, number, number][] = [
    [0, -1, balance.fire], // top: fire
    [1, 0, balance.air], // right: air
    [0, 1, balance.earth], // bottom: earth
    [-1, 0, balance.water], // left: water
  ];

  const coords = points.map(([dx, dy, v]) => {
    const r = 14 + v * maxR;
    return `${cx + dx * r},${cy + dy * r}`;
  });

  const polygon = coords.join(" ");

  return (
    <svg width={size} height={size} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx={cx} cy={cy} r={maxR + 14} stroke="#2A2926" strokeWidth="1" fill="none" />
      <line x1={cx} y1={cy - maxR - 14} x2={cx} y2={cy + maxR + 14} stroke="#2A2926" strokeWidth="0.6" />
      <line x1={cx - maxR - 14} y1={cy} x2={cx + maxR + 14} y2={cy} stroke="#2A2926" strokeWidth="0.6" />
      <polygon points={polygon} fill="none" stroke="#F5F3EE" strokeWidth="1.2" strokeLinejoin="round" />
      {coords.map((c, i) => {
        const [x, y] = c.split(",").map(Number);
        return <circle key={i} cx={x} cy={y} r="2" fill="#F5F3EE" />;
      })}
      <text x={cx} y={8} textAnchor="middle" fill="#8A8580" fontSize="7" fontFamily="var(--font-mono)" letterSpacing="1">
        FIRE
      </text>
      <text x={114} y={cy + 3} textAnchor="end" fill="#8A8580" fontSize="7" fontFamily="var(--font-mono)" letterSpacing="1">
        AIR
      </text>
      <text x={cx} y={117} textAnchor="middle" fill="#8A8580" fontSize="7" fontFamily="var(--font-mono)" letterSpacing="1">
        EARTH
      </text>
      <text x={6} y={cy + 3} textAnchor="start" fill="#8A8580" fontSize="7" fontFamily="var(--font-mono)" letterSpacing="1">
        WATER
      </text>
    </svg>
  );
}
