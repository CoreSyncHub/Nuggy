import { formatCount, formatDate } from "../Formatting";

const digitsOf = (s: string) => s.replace(/\D/g, "");

describe("formatCount", () => {
  it("groups thousands according to the active language", () => {
    expect(digitsOf(formatCount(1234567, "en"))).toBe("1234567");
    expect(digitsOf(formatCount(1234567, "fr"))).toBe("1234567");
    // The separator differs from one language to the next: that is the whole point of
    // the fix, formatting was pinned to fr-FR whatever the interface language.
    expect(formatCount(1234567, "en")).not.toBe(formatCount(1234567, "fr"));
  });

  it("returns an empty string for an absent value", () => {
    expect(formatCount(undefined, "fr")).toBe("");
  });

  it("formats zero rather than confusing it with an absence", () => {
    expect(formatCount(0, "en")).toBe("0");
  });

  it("does not throw on an invalid language tag", () => {
    // currentLanguage comes from a VS Code setting, but a silent fallback beats
    // an exception that would break the rendering of the whole view.
    expect(digitsOf(formatCount(42, "not a language"))).toBe("42");
  });
});

describe("formatDate", () => {
  it("formats an ISO date according to the active language", () => {
    const en = formatDate("2024-06-08T10:00:00Z", "en");
    const fr = formatDate("2024-06-08T10:00:00Z", "fr");
    expect(en).toContain("2024");
    expect(fr).toContain("2024");
    expect(en).not.toBe(fr);
  });

  it("returns an empty string for an absent or invalid date", () => {
    expect(formatDate(undefined, "fr")).toBe("");
    expect(formatDate("not a date", "fr")).toBe("");
  });

  it("does not throw on an invalid language tag", () => {
    expect(formatDate("2024-06-08T10:00:00Z", "not a language")).toContain("2024");
  });
});
