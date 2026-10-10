import { z } from "zod";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz === "UTC" || /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(tz);
  } catch {
    return false;
  }
}

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as AUD.");

export const displaySchema = z.object({
  timezone: z.string().trim().refine(isValidTimezone, "That is not a known timezone. Try a name like Asia/Hong_Kong."),
  currency,
  threshold: z.coerce.number({ message: "Enter a number." }).min(0, "Use 0 or more.").max(1_000_000, "That is too large."),
});
export type DisplayInput = z.infer<typeof displaySchema>;

export const rateSchema = z
  .object({
    base: currency,
    quote: currency,
    rate: z.coerce.number({ message: "Enter a rate." }).positive("The rate must be above 0.").max(1e9, "That rate is too large."),
  })
  .refine((r) => r.base !== r.quote, { message: "Pick two different currencies." });

export const symbolSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{1,20}$/, "Use letters and digits, such as XAUUSD."),
  pipSize: z.coerce.number({ message: "Enter the pip size." }).positive("Pip size must be above 0.").max(1000),
  contractSize: z.coerce.number({ message: "Enter the contract size." }).positive("Contract size must be above 0.").max(1e9),
});

export const tagNameSchema = z.string().trim().min(1, "Give it a name.").max(60, "Keep it under 60 characters.");

export const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: z.string().min(10, "Use at least 10 characters.").max(200, "That is too long."),
    confirm: z.string(),
  })
  .refine((p) => p.next === p.confirm, { message: "The new passwords do not match.", path: ["confirm"] })
  .refine((p) => p.next !== p.current, { message: "Choose a password different from the current one.", path: ["next"] });

/** First problem in plain words, for showing under a form. */
export const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Check the values and try again.";
