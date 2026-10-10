import { describe, expect, it } from "vitest";
import { SERVER_PATTERN, STARTER_SERVERS, brokerFor, suggestServers } from "@/lib/brokers/servers";

describe("suggestServers", () => {
  it("finds servers from a few letters, prefix matches first", () => {
    const r = suggestServers("icm").map((s) => s.server);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.toLowerCase().includes("icm"))).toBe(true);
    expect(r[0]).toBe("ICMarketsSC-Demo");
  });
  it("is case-, space- and dash-insensitive", () => {
    expect(suggestServers("ic markets sc live 01")[0].server).toBe("ICMarketsSC-Live01");
    expect(suggestServers("ICMARKETSSC-LIVE02")[0].server).toBe("ICMarketsSC-Live02");
  });
  it("matches inside the name and on the broker name", () => {
    expect(suggestServers("live").length).toBe(8); // capped
    expect(suggestServers("pepper").map((s) => s.server)).toContain("Pepperstone-Live");
    expect(suggestServers("admiral")[0].broker).toBe("Admiral Markets");
    expect(suggestServers("xm", [], 20).some((s) => s.server === "XMGlobal-Real 1")).toBe(true);
  });
  it("puts the servers you already use first, once", () => {
    const r = suggestServers("icm", ["ICMarketsSC-Live07"]);
    expect(r[0]).toEqual({ server: "ICMarketsSC-Live07", broker: "Your server" });
    expect(r.filter((s) => s.server === "ICMarketsSC-Live07")).toHaveLength(1);
  });
  it("an empty box lists your servers and then the start of the list; nonsense finds nothing", () => {
    expect(suggestServers("", ["Mine-Live"])[0].server).toBe("Mine-Live");
    expect(suggestServers("zzzzzz")).toEqual([]);
  });
  it("every starter name is unique and storable", () => {
    const names = STARTER_SERVERS.map((s) => s.server);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => SERVER_PATTERN.test(n))).toBe(true);
  });
  it("knows the broker for a server name", () => {
    expect(brokerFor("icmarketssc-live01")).toBe("IC Markets");
    expect(brokerFor("SomethingElse-Live")).toBeNull();
  });
});

describe("SERVER_PATTERN", () => {
  it("accepts real-looking names and refuses odd ones", () => {
    for (const ok of ["ICMarketsSC-Live01", "XMGlobal-Real 7", "Broker_Demo.2", "Name (Live)"]) expect(SERVER_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["", " leading", "a".repeat(81), "x;drop", "<script>", "a\nb", "-start"]) expect(SERVER_PATTERN.test(bad), bad).toBe(false);
  });
});
