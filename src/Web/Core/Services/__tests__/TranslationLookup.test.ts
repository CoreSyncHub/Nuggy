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
  it("resolves a dot-notation key", () => {
    expect(lookupTranslation(EN, "packages.list.loadMore")).toBe("Load more");
  });

  it("returns undefined when the key is absent", () => {
    expect(lookupTranslation(EN, "packages.list.absente")).toBeUndefined();
  });

  it("returns undefined when the path crosses a non-object value", () => {
    expect(lookupTranslation(EN, "packages.list.loadMore.trop.loin")).toBeUndefined();
  });

  it("returns undefined when the final value is not a string", () => {
    // An intermediate node is not a displayable translation.
    expect(lookupTranslation(EN, "packages.list")).toBeUndefined();
  });

  it("does not resolve keys inherited from the prototype", () => {
    // "constructor" exists on every object: without a guard, it would surface a function.
    expect(lookupTranslation(EN, "constructor")).toBeUndefined();
    expect(lookupTranslation(EN, "packages.toString")).toBeUndefined();
  });
});

describe("interpolate", () => {
  it("substitutes parameters between double braces", () => {
    expect(interpolate("{{count}} downloads", { count: 12 })).toBe("12 downloads");
  });

  it("leaves a parameter that is not supplied untouched", () => {
    expect(interpolate("{{count}} downloads", { autre: 1 })).toBe("{{count}} downloads");
  });
});

describe("translate", () => {
  it("prefers the active language when the key exists there", () => {
    expect(translate(ES, EN, "packages.list.loadMore")).toBe("Cargar más");
  });

  it("falls back to English when the active language lacks the key", () => {
    // Heart of the fix: an incomplete locale used to display the raw path
    // ("packages.list.downloads") straight into the interface.
    expect(translate(ES, EN, "packages.list.downloads", { count: 7 })).toBe("7 downloads");
  });

  it("interpolates the value coming from the fallback too", () => {
    expect(translate(ES, EN, "packages.list.downloads", { count: 3 })).toContain("3");
  });

  it("returns the key as a last resort, when even the fallback ignores it", () => {
    expect(translate(ES, EN, "packages.inconnue")).toBe("packages.inconnue");
  });

  it("works with an empty fallback, without throwing", () => {
    expect(translate(ES, {}, "packages.list.loadMore")).toBe("Cargar más");
    expect(translate(ES, {}, "packages.list.downloads")).toBe("packages.list.downloads");
  });
});
