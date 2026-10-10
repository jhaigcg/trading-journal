export interface PlaybookTemplate {
  key: string;
  name: string;
  color: string;
  description: string;
  groups: { name: string; rules: string[] }[];
}

/**
 * Starter playbooks in Smart Money Concepts vocabulary. "Create from template" copies one; the copy is yours
 * to edit freely. The first three are also what the demo data is seeded with.
 */
export const PLAYBOOK_TEMPLATES: PlaybookTemplate[] = [
  {
    key: "key-reversal",
    name: "Key reversal area – 5M CHoCH/BOS confirmation",
    color: "#E0B04E",
    description: "Wait for price to tap a higher-timeframe key area, then enter on a 5M CHoCH/BOS confirmation.",
    groups: [
      { name: "Context", rules: ["HTF key area identified (H1/H4)", "Price swept liquidity into the area", "Trading with session bias"] },
      { name: "Entry", rules: ["5M CHoCH or BOS confirmed", "Entry on OB/FVG retrace", "Stop beyond the sweep"] },
      { name: "Management", rules: ["Minimum 2R target planned", "Moved to breakeven only after BOS"] },
    ],
  },
  {
    key: "trend-continuation",
    name: "Trend continuation – 15M/5M OB",
    color: "#7FB7F0",
    description: "Trade pullbacks into a 15M order block in the direction of the prevailing trend, refined on 5M.",
    groups: [
      { name: "Context", rules: ["15M structure trending (HH/HL or LH/LL)", "Pullback into discount/premium"] },
      { name: "Entry", rules: ["15M OB mitigated", "5M confirmation inside OB", "Stop under/over OB"] },
    ],
  },
  {
    key: "range-second-touch",
    name: "Ranging – 2nd touch OB/Liquidity – limit order",
    color: "#3DD39A",
    description: "In a range, place a limit order at the second touch of an OB / liquidity pool at the range extremes.",
    groups: [
      { name: "Context", rules: ["Clear range with 2+ touches", "No high-impact news in the next 30 min"] },
      { name: "Entry", rules: ["Limit order at 2nd touch OB/liquidity", "Target the opposite range extreme"] },
    ],
  },
  {
    key: "sweep-choch",
    name: "Liquidity sweep → CHoCH reversal",
    color: "#F26B6F",
    description: "Fade a clean sweep of an obvious high or low once a lower-timeframe change of character confirms the turn.",
    groups: [
      { name: "Context", rules: ["Obvious equal highs/lows or session high/low taken", "Sweep happens at or near a key level", "Not trading straight into high-impact news"] },
      { name: "Entry", rules: ["CHoCH on 1M/5M after the sweep", "Entry on the FVG or OB left by the displacement", "Stop beyond the sweep wick"] },
      { name: "Management", rules: ["First target: the internal range high/low", "Runner only if the next liquidity pool is clear"] },
    ],
  },
  {
    key: "breaker-retest",
    name: "Breaker block retest",
    color: "#C792EA",
    description: "After a structure break that flips an order block into a breaker, enter on the retest in the new direction.",
    groups: [
      { name: "Context", rules: ["Break of structure confirmed with displacement", "Failed order block identified as the breaker", "HTF bias agrees"] },
      { name: "Entry", rules: ["Price returns to the breaker block", "Rejection candle or LTF CHoCH inside the breaker", "Stop beyond the breaker"] },
    ],
  },
  {
    key: "session-open-fakeout",
    name: "Session open fake-out (Judas swing)",
    color: "#FFB86C",
    description: "Trade the reversal after the first impulsive move of a session takes liquidity in the wrong direction.",
    groups: [
      { name: "Context", rules: ["Asian range marked before the session opens", "First move breaks the range against HTF bias", "Not within 15 min of high-impact news"] },
      { name: "Entry", rules: ["Return inside the range with displacement", "Entry on the retrace into FVG/OB", "Stop above/below the fake-out extreme"] },
      { name: "Management", rules: ["Target the opposite side of the Asian range", "Done for the session after two attempts"] },
    ],
  },
];
