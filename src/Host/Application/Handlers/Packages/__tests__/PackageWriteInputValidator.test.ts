import { isValidPackageId, isValidVersion } from "../PackageWriteInputValidator";

describe("PackageWriteInputValidator (Finding 3a)", () => {
  it("accepte un packageId usuel (lettres, chiffres, points, tirets, underscores)", () => {
    expect(isValidPackageId("Newtonsoft.Json")).toBe(true);
    expect(isValidPackageId("Microsoft.Extensions.Logging_Abstractions-2")).toBe(true);
  });

  it("refuse un packageId porteur de caractères d'injection XML", () => {
    expect(isValidPackageId('Evil" Foo="bar')).toBe(false);
    expect(isValidPackageId("Evil<x>")).toBe(false);
    expect(isValidPackageId("Evil&Co")).toBe(false);
    expect(isValidPackageId("")).toBe(false);
  });

  it("accepte une version usuelle (SemVer, wildcard)", () => {
    expect(isValidVersion("13.0.3")).toBe(true);
    expect(isValidVersion("8.*")).toBe(true);
    expect(isValidVersion("1.0.0-beta.1+build.2")).toBe(true);
  });

  it("refuse une version porteuse de caractères d'injection XML", () => {
    expect(isValidVersion('1.0.0" Foo="bar')).toBe(false);
    expect(isValidVersion("1.0.0<x>")).toBe(false);
    expect(isValidVersion("1.0.0&amp;")).toBe(false);
    expect(isValidVersion("")).toBe(false);
  });
});
