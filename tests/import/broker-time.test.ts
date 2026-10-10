import { describe, expect, it } from "vitest";
import { brokerEpochToUtc, brokerOffsetMinutesAt, isValidBrokerTimeMode } from "@/lib/time";

// MT4 stores server time as seconds-since-epoch of the server's wall clock
const wall = (iso: string) => Date.parse(iso + "Z") / 1000;

describe("brokerEpochToUtc", () => {
  it("NYCLOSE is GMT+2 in winter", () => {
    expect(brokerEpochToUtc(wall("2026-01-15T12:00:00"), "NYCLOSE").toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });
  it("NYCLOSE is GMT+3 in summer", () => {
    expect(brokerEpochToUtc(wall("2026-07-15T12:00:00"), "NYCLOSE").toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });
  it("NYCLOSE switches on the US daylight-saving date (2026-03-08), not the EU one", () => {
    // 2026-03-10 is after US DST start but before EU DST start → already GMT+3
    expect(brokerEpochToUtc(wall("2026-03-10T12:00:00"), "NYCLOSE").toISOString()).toBe("2026-03-10T09:00:00.000Z");
    // 2026-03-05 is before both → GMT+2
    expect(brokerEpochToUtc(wall("2026-03-05T12:00:00"), "NYCLOSE").toISOString()).toBe("2026-03-05T10:00:00.000Z");
  });
  it("fixed offsets ignore daylight saving", () => {
    expect(brokerEpochToUtc(wall("2026-07-15T12:00:00"), "UTC+2").toISOString()).toBe("2026-07-15T10:00:00.000Z");
    expect(brokerEpochToUtc(wall("2026-07-15T12:00:00"), "UTC-5").toISOString()).toBe("2026-07-15T17:00:00.000Z");
    expect(brokerEpochToUtc(wall("2026-07-15T12:00:00"), "UTC+5.5").toISOString()).toBe("2026-07-15T06:30:00.000Z");
  });
  it("IANA zone (EU daylight saving)", () => {
    expect(brokerEpochToUtc(wall("2026-03-10T12:00:00"), "Europe/Helsinki").toISOString()).toBe("2026-03-10T10:00:00.000Z");
    expect(brokerEpochToUtc(wall("2026-07-15T12:00:00"), "Europe/Helsinki").toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });
});

describe("brokerOffsetMinutesAt", () => {
  it("reports the offset in force at an instant", () => {
    expect(brokerOffsetMinutesAt(new Date("2026-01-15T10:00:00Z"), "NYCLOSE")).toBe(120);
    expect(brokerOffsetMinutesAt(new Date("2026-07-15T10:00:00Z"), "NYCLOSE")).toBe(180);
    expect(brokerOffsetMinutesAt(new Date("2026-07-15T10:00:00Z"), "UTC+2")).toBe(120);
  });
});

describe("isValidBrokerTimeMode", () => {
  it("accepts presets, fixed offsets and IANA zones only", () => {
    expect(isValidBrokerTimeMode("NYCLOSE")).toBe(true);
    expect(isValidBrokerTimeMode("UTC+3")).toBe(true);
    expect(isValidBrokerTimeMode("Europe/Helsinki")).toBe(true);
    expect(isValidBrokerTimeMode("banana")).toBe(false);
  });
});
