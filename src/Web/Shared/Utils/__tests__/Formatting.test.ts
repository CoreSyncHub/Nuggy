import { formatCount, formatDate } from "../Formatting";

const digitsOf = (s: string) => s.replace(/\D/g, "");

describe("formatCount", () => {
  it("groupe les milliers selon la langue active", () => {
    expect(digitsOf(formatCount(1234567, "en"))).toBe("1234567");
    expect(digitsOf(formatCount(1234567, "fr"))).toBe("1234567");
    // Le séparateur diffère d'une langue à l'autre : c'est tout l'objet du correctif,
    // le formatage était figé en fr-FR quelle que soit la langue de l'interface.
    expect(formatCount(1234567, "en")).not.toBe(formatCount(1234567, "fr"));
  });

  it("rend une chaîne vide pour une valeur absente", () => {
    expect(formatCount(undefined, "fr")).toBe("");
  });

  it("formate zéro plutôt que de le confondre avec une absence", () => {
    expect(formatCount(0, "en")).toBe("0");
  });

  it("ne jette pas sur une étiquette de langue invalide", () => {
    // currentLanguage vient d'un réglage VS Code, mais un repli silencieux vaut
    // mieux qu'une exception qui casserait le rendu de toute la vue.
    expect(digitsOf(formatCount(42, "pas une langue"))).toBe("42");
  });
});

describe("formatDate", () => {
  it("formate une date ISO selon la langue active", () => {
    const en = formatDate("2024-06-08T10:00:00Z", "en");
    const fr = formatDate("2024-06-08T10:00:00Z", "fr");
    expect(en).toContain("2024");
    expect(fr).toContain("2024");
    expect(en).not.toBe(fr);
  });

  it("rend une chaîne vide pour une date absente ou invalide", () => {
    expect(formatDate(undefined, "fr")).toBe("");
    expect(formatDate("pas une date", "fr")).toBe("");
  });

  it("ne jette pas sur une étiquette de langue invalide", () => {
    expect(formatDate("2024-06-08T10:00:00Z", "pas une langue")).toContain("2024");
  });
});
