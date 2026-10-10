/** Tiny line chart for a series (cumulative P&L). Pure SVG, renders on the server. */
export function Spark({ values, width = 120, height = 36, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (values.length < 2) return <div style={{ width, height }} className={className} aria-hidden />;
  const pts = [0, ...values]; // every series starts from zero
  const min = Math.min(...pts, 0);
  const max = Math.max(...pts, 0);
  const span = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= 0;
  const color = up ? "var(--profit)" : "var(--loss)";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} role="img" aria-label={`P&L trend, ending ${up ? "up" : "down"}`} preserveAspectRatio="none">
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeDasharray="2 3" />
      <polygon points={`${x(0)},${y(0)} ${line} ${x(pts.length - 1)},${y(0)}`} fill={color} fillOpacity="0.12" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}
