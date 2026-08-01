import { PackageSearchService } from "../PackageSearchService";
import {
  type IPackageSearchSource,
  type PackageSearchHit,
} from "@/Host/Application/Abstractions/Search/IPackageSearchSource";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

const noOpLogger: ILogger = {
  Info: jest.fn(),
  Warning: jest.fn(),
  Error: jest.fn(),
  Debug: jest.fn(),
};

function hit(id: string, sourceName: string): PackageSearchHit {
  return {
    id,
    description: `${id} description`,
    latestVersion: "1.0.0",
    verified: false,
    sourceName,
  };
}

/** rawCount defaults to hits.length: tests that do not care about pre-service
 *  filtering (most of them) then keep the same semantics as before
 *  PackageSearchPage was introduced. An explicit rawCount simulates a source whose
 *  raw page held more entries than usable hits. */
function source(
  name: string,
  hits: PackageSearchHit[],
  rawCount = hits.length,
): IPackageSearchSource {
  return { name, search: jest.fn().mockResolvedValue({ hits, rawCount }) };
}

function failingSource(name: string): IPackageSearchSource {
  return { name, search: jest.fn().mockRejectedValue(new Error("injoignable")) };
}

const OPTIONS = { skip: 0, take: 2, includePrerelease: false };

describe("PackageSearchService", () => {
  it("merges the results while preserving the source order", async () => {
    const service = new PackageSearchService(
      [
        source("nuget.org", [hit("Refit", "nuget.org")]),
        source("interne", [hit("Maison", "interne")]),
      ],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits.map((h) => h.id)).toEqual(["Refit", "Maison"]);
    expect(outcome.failedSources).toEqual([]);
    // Discriminating case: each source returns only 1 hit for take=2, so NONE of
    // them filled its page. A faulty hasMore computed after deduplication would
    // see 2 merged hits >= take and wrongly conclude true.
    expect(outcome.hasMore).toBe(false);
  });

  it("deduplicates by case-insensitive id, the higher-priority source wins", async () => {
    const service = new PackageSearchService(
      [
        source("nuget.org", [hit("Refit", "nuget.org")]),
        source("interne", [hit("REFIT", "interne"), hit("Maison", "interne")]),
      ],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits.map((h) => h.id)).toEqual(["Refit", "Maison"]);
    expect(outcome.hits[0].sourceName).toBe("nuget.org");
  });

  it("isolates a failing source and names the ones that failed", async () => {
    const service = new PackageSearchService(
      [source("nuget.org", [hit("Refit", "nuget.org")]), failingSource("interne")],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits.map((h) => h.id)).toEqual(["Refit"]);
    expect(outcome.failedSources).toEqual(["interne"]);
  });

  it("returns an empty list and names every source when none answers", async () => {
    const service = new PackageSearchService(
      [failingSource("nuget.org"), failingSource("interne")],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits).toEqual([]);
    expect(outcome.failedSources).toEqual(["nuget.org", "interne"]);
    expect(outcome.hasMore).toBe(false);
  });

  it("hasMore is true as soon as one source returns a full page, judged before deduplication", async () => {
    // Both sources return the SAME packages: after deduplication only 2 hits remain
    // for take=2, yet more results exist downstream.
    const service = new PackageSearchService(
      [
        source("nuget.org", [hit("A", "nuget.org"), hit("B", "nuget.org")]),
        source("interne", [hit("a", "interne"), hit("b", "interne")]),
      ],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits).toHaveLength(2);
    expect(outcome.hasMore).toBe(true);
  });

  it("hasMore stays true when pre-service filtering shortened the hits below take (full raw page)", async () => {
    // The source received 2 raw entries from nuget.org (take=2, full page) but
    // only one survived the filtering of non-installable entries (without a
    // version): rawCount=2 keeps the truth, hits.length=1 must not be used to
    // judge the end of the results.
    const service = new PackageSearchService(
      [source("nuget.org", [hit("A", "nuget.org")], 2)],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits.length).toBeLessThan(OPTIONS.take);
    expect(outcome.hasMore).toBe(true);
  });

  it("hasMore is false when no source fills its page", async () => {
    const service = new PackageSearchService(
      [source("nuget.org", [hit("A", "nuget.org")])],
      noOpLogger,
    );
    await expect(service.search("x", OPTIONS)).resolves.toMatchObject({ hasMore: false });
  });

  it("passes the same skip and take to every source", async () => {
    const first = source("nuget.org", []);
    const second = source("interne", []);
    const service = new PackageSearchService([first, second], noOpLogger);

    await service.search("refit", { skip: 25, take: 25, includePrerelease: true });

    const expected = ["refit", { skip: 25, take: 25, includePrerelease: true }];
    expect(first.search).toHaveBeenCalledWith(...expected);
    expect(second.search).toHaveBeenCalledWith(...expected);
  });
});
