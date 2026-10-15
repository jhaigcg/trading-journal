import { describe, expect, it } from "vitest";
import { checkImage, MAX_UPLOAD_BYTES } from "@/lib/storage";

const png = (size: number) => {
  const b = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return b;
};

describe("upload size limit", () => {
  it("stays under Vercel's 4.5 MB request cap", () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
  it("accepts an image at the limit and refuses one a byte over with a clear message", () => {
    expect(checkImage("image/png", png(MAX_UPLOAD_BYTES)).ok).toBe(true);
    const over = checkImage("image/png", png(MAX_UPLOAD_BYTES + 1));
    expect(over).toEqual({ ok: false, error: expect.stringContaining("4 MB") });
  });
});
