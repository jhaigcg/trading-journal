/** Timeframes and names shared by the server and the browser (this file must not import anything server-only). */
export const SETUP_TFS = ["M1", "M5", "M15", "H1"] as const;
export const EVENT_TFS = ["S5", "M1"] as const;
export type TrainTf = (typeof SETUP_TFS)[number] | (typeof EVENT_TFS)[number];
export const TF_NAMES: Record<string, string> = { S5: "5s", M1: "1m", M5: "5m", M15: "15m", H1: "1h" };
export const tfsFor = (kind: "SETUP" | "EVENT"): readonly string[] => (kind === "EVENT" ? EVENT_TFS : SETUP_TFS);
