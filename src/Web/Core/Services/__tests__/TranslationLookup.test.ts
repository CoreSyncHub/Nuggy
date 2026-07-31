import { interpolate, lookupTranslation, translate } from "../TranslationLookup";

const EN = {
  packages: {
    list: { loadMore: "Load more", downloads: "{{count}} downloads" },
    detail: { title: "Details" },
  },
};

const ES = {
  packages: {
    list: { loadMore: "Cargar más" },
  },
};

describe("lookupTranslation", () => {
  it("résout une clé en notation pointée", () => {
    expect(lookupTranslation(EN, "packages.list.loadMore")).toBe("Load more");
  });

  it("rend undefined quand la clé est absente", () => {
    expect(lookupTranslation(EN, "packages.list.absente")).toBeUndefined();
  });

  it("rend undefined quand le chemin traverse une valeur non-objet", () => {
    expect(lookupTranslation(EN, "packages.list.loadMore.trop.loin")).toBeUndefined();
  });

  it("rend undefined quand la valeur finale n'est pas une chaîne", () => {
    // Un nœud intermédiaire n'est pas une traduction affichable.
    expect(lookupTranslation(EN, "packages.list")).toBeUndefined();
  });

  it("ne résout pas les clés héritées du prototype", () => {
    // "constructor" existe sur tout objet : sans garde, il remonterait une fonction.
    expect(lookupTranslation(EN, "constructor")).toBeUndefined();
    expect(lookupTranslation(EN, "packages.toString")).toBeUndefined();
  });
});

describe("interpolate", () => {
  it("remplace les paramètres entre doubles accolades", () => {
    expect(interpolate("{{count}} downloads", { count: 12 })).toBe("12 downloads");
  });

  it("laisse intact un paramètre non fourni", () => {
    expect(interpolate("{{count}} downloads", { autre: 1 })).toBe("{{count}} downloads");
  });
});

describe("translate", () => {
  it("préfère la langue active quand la clé y existe", () => {
    expect(translate(ES, EN, "packages.list.loadMore")).toBe("Cargar más");
  });

  it("retombe sur l'anglais quand la langue active n'a pas la clé", () => {
    // Cœur du correctif : une locale incomplète affichait le chemin brut
    // (« packages.list.downloads ») directement dans l'interface.
    expect(translate(ES, EN, "packages.list.downloads", { count: 7 })).toBe("7 downloads");
  });

  it("interpole aussi la valeur venue du repli", () => {
    expect(translate(ES, EN, "packages.list.downloads", { count: 3 })).toContain("3");
  });

  it("rend la clé en dernier recours, quand même le repli l'ignore", () => {
    expect(translate(ES, EN, "packages.inconnue")).toBe("packages.inconnue");
  });

  it("fonctionne avec un repli vide, sans jeter", () => {
    expect(translate(ES, {}, "packages.list.loadMore")).toBe("Cargar más");
    expect(translate(ES, {}, "packages.list.downloads")).toBe("packages.list.downloads");
  });
});
