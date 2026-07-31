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

/** rawCount vaut par défaut hits.length : les tests qui ne s'intéressent pas au
 *  filtrage pré-service (la plupart) gardent alors la même sémantique qu'avant
 *  l'introduction de PackageSearchPage. Un rawCount explicite simule une source
 *  dont la page brute contenait plus d'entrées que de hits utilisables. */
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
  it("fusionne les résultats en conservant l'ordre des sources", async () => {
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
    // Discriminant : chaque source ne renvoie qu'1 hit pour take=2, donc AUCUNE
    // n'a rempli sa page. Un calcul fautif de hasMore fait après déduplication
    // verrait 2 hits fusionnés >= take et conclurait à tort à true.
    expect(outcome.hasMore).toBe(false);
  });

  it("déduplique par id insensible à la casse, la source prioritaire l'emporte", async () => {
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

  it("isole une source en échec et nomme celles qui ont échoué", async () => {
    const service = new PackageSearchService(
      [source("nuget.org", [hit("Refit", "nuget.org")]), failingSource("interne")],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits.map((h) => h.id)).toEqual(["Refit"]);
    expect(outcome.failedSources).toEqual(["interne"]);
  });

  it("rend une liste vide et nomme toutes les sources quand aucune ne répond", async () => {
    const service = new PackageSearchService(
      [failingSource("nuget.org"), failingSource("interne")],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits).toEqual([]);
    expect(outcome.failedSources).toEqual(["nuget.org", "interne"]);
    expect(outcome.hasMore).toBe(false);
  });

  it("hasMore vrai dès qu'une source renvoie une page pleine, jugé avant déduplication", async () => {
    // Les deux sources renvoient les MÊMES packages : après déduplication il ne
    // reste que 2 hits pour take=2, mais d'autres résultats existent en aval.
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

  it("hasMore reste vrai quand le filtrage pré-service a raccourci les hits sous take (page brute pleine)", async () => {
    // La source a reçu 2 entrées brutes de nuget.org (take=2, page pleine) mais
    // une seule a survécu au filtrage des entrées non installables (sans
    // version) : rawCount=2 conserve la vérité, hits.length=1 ne doit pas être
    // utilisé pour juger de la fin des résultats.
    const service = new PackageSearchService(
      [source("nuget.org", [hit("A", "nuget.org")], 2)],
      noOpLogger,
    );

    const outcome = await service.search("x", OPTIONS);

    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits.length).toBeLessThan(OPTIONS.take);
    expect(outcome.hasMore).toBe(true);
  });

  it("hasMore faux quand aucune source ne remplit sa page", async () => {
    const service = new PackageSearchService(
      [source("nuget.org", [hit("A", "nuget.org")])],
      noOpLogger,
    );
    await expect(service.search("x", OPTIONS)).resolves.toMatchObject({ hasMore: false });
  });

  it("transmet les mêmes skip et take à chaque source", async () => {
    const first = source("nuget.org", []);
    const second = source("interne", []);
    const service = new PackageSearchService([first, second], noOpLogger);

    await service.search("refit", { skip: 25, take: 25, includePrerelease: true });

    const expected = ["refit", { skip: 25, take: 25, includePrerelease: true }];
    expect(first.search).toHaveBeenCalledWith(...expected);
    expect(second.search).toHaveBeenCalledWith(...expected);
  });
});
