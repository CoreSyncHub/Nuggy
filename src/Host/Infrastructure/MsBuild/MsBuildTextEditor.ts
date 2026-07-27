import { singleton } from "tsyringe";

export type EditResult = { ok: true; content: string } | { ok: false; reason: string };
export type FoundElement = { start: number; end: number; attributes: Record<string, string> };
export type ItemElementName = "PackageReference" | "PackageVersion";

/** Caractères qui permettraient d'échapper à une valeur d'attribut XML (injection MSBuild). */
const XML_INJECTION_PATTERN = /["'<>&]/;

/**
 * Chirurgie textuelle des fichiers MSBuild : modifications ciblées qui
 * préservent byte-à-byte tout ce qui n'est pas la zone éditée (indentation,
 * commentaires, CRLF, BOM). Service pur : aucune I/O, string → string.
 */
@singleton()
export class MsBuildTextEditor {
  /**
   * Localise l'élément <elementName ... Include="packageId" ... /> (id insensible
   * à la casse). Les éléments Update= sont ignorés (hors périmètre v1).
   */
  public findItemElement(
    content: string,
    elementName: ItemElementName,
    packageId: string
  ): FoundElement | undefined {
    const elementPattern = new RegExp(`<${elementName}\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:/>|>)`, "gs");
    for (const match of content.matchAll(elementPattern)) {
      const attributes = this.parseAttributes(match[0]);
      if (attributes["Include"]?.toLowerCase() === packageId.toLowerCase()) {
        const openTagEnd = match.index + match[0].length;
        const end = this.elementSpanEnd(content, elementName, openTagEnd, match[0]);
        return { start: match.index, end, attributes };
      }
    }
    return undefined;
  }

  /**
   * Étend la fin d'un élément trouvé (par défaut la fin de la balise ouvrante) jusqu'à
   * la fin de sa balise fermante `</elementName>` lorsqu'il est en forme bloc (Finding 1) :
   * `<PackageReference Include="X" Version="1"><PrivateAssets>all</PrivateAssets></PackageReference>`.
   * Les éléments auto-fermants (`/>`) n'ont, par construction, aucun enfant : leur span
   * s'arrête déjà à `openTagEnd`.
   */
  private elementSpanEnd(
    text: string,
    elementName: string,
    openTagEnd: number,
    openTagText: string
  ): number {
    if (openTagText.endsWith("/>")) {
      return openTagEnd;
    }
    const closeTag = `</${elementName}>`;
    const closeIndex = text.indexOf(closeTag, openTagEnd);
    return closeIndex === -1 ? openTagEnd : closeIndex + closeTag.length;
  }

  /** Refuse toute valeur d'attribut porteuse d'un caractère capable de rompre l'attribut XML. */
  private validateAttributeValues(attributes: Record<string, string>): EditResult | undefined {
    for (const [key, value] of Object.entries(attributes)) {
      if (XML_INJECTION_PATTERN.test(value)) {
        return {
          ok: false,
          reason: `valeur invalide pour l'attribut '${key}' : caractères interdits (" ' < > &)`,
        };
      }
    }
    return undefined;
  }

  /** Remplace la valeur de l'attribut Version de TOUS les éléments correspondants. */
  public setVersionAttribute(
    content: string,
    elementName: ItemElementName,
    packageId: string,
    newVersion: string
  ): EditResult {
    const invalid = this.validateAttributeValues({ Version: newVersion });
    if (invalid) {
      return invalid;
    }
    const elementPattern = new RegExp(`<${elementName}\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:/>|>)`, "gs");
    const replacements: Array<{ elementStart: number; elementEnd: number; attrStart: number; attrEnd: number; newValue: string }> = [];

    for (const match of content.matchAll(elementPattern)) {
      const attributes = this.parseAttributes(match[0]);
      if (attributes["Include"]?.toLowerCase() === packageId.toLowerCase()) {
        const elementText = match[0];
        const versionAttr = /(\bVersion\s*=\s*)(["'])(.*?)\2/s.exec(elementText);
        if (!versionAttr) {
          return { ok: false, reason: `l'élément '${packageId}' n'a pas d'attribut Version` };
        }
        const quote = versionAttr[2];
        const attrStart = match.index + versionAttr.index;
        const attrEnd = attrStart + versionAttr[0].length;
        const newValue = `${versionAttr[1]}${quote}${newVersion}${quote}`;
        replacements.push({
          elementStart: match.index,
          elementEnd: match.index + elementText.length,
          attrStart,
          attrEnd,
          newValue,
        });
      }
    }

    if (replacements.length === 0) {
      return { ok: false, reason: `élément ${elementName} '${packageId}' introuvable` };
    }

    // Appliquer les remplacements du dernier au premier pour préserver les offsets
    let result = content;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { attrStart, attrEnd, newValue } = replacements[i];
      const before = result.slice(0, attrStart);
      const after = result.slice(attrEnd);
      result = `${before}${newValue}${after}`;
    }

    return { ok: true, content: result };
  }

  /** Insère un élément ; refuse les doublons ; jamais dans un ItemGroup conditionné. */
  public addItemElement(
    content: string,
    elementName: ItemElementName,
    attributes: Record<string, string>
  ): EditResult {
    const include = attributes["Include"];
    if (!include) {
      return { ok: false, reason: "attribut Include requis" };
    }
    const invalid = this.validateAttributeValues(attributes);
    if (invalid) {
      return invalid;
    }
    if (this.findItemElement(content, elementName, include)) {
      return { ok: false, reason: `'${include}' est déjà présent` };
    }
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const attrText = Object.entries(attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");

    // Groupes non conditionnés contenant déjà des éléments du même type
    const groupPattern = /<ItemGroup(\s(?:"[^"]*"|'[^']*'|[^>"'])*)?>([\s\S]*?)<\/ItemGroup>/g;
    for (const group of content.matchAll(groupPattern)) {
      if (group[1] && /\bCondition\s*=/.test(group[1])) {
        continue;
      }
      const body = group[2];
      const siblingPattern = new RegExp(`([ \\t]*)<${elementName}\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:/>|>)`, "g");
      const siblings = [...body.matchAll(siblingPattern)];
      if (siblings.length === 0) {
        continue;
      }
      const indent = siblings[0][1];
      const newLine = `${indent}<${elementName} ${attrText} />`;
      const includes = siblings.map((s) => this.parseAttributes(s[0])["Include"] ?? "");
      const isSorted = includes.every(
        (id, i) => i === 0 || includes[i - 1].toLowerCase() <= id.toLowerCase()
      );
      // Position juste après le sibling précédent : la balise ouvrante pour une forme
      // auto-fermante, mais après la balise FERMANTE pour une forme bloc — sans quoi
      // l'insertion atterrirait à l'intérieur de l'élément précédent (Finding 1).
      const lastSibling = siblings[siblings.length - 1];
      const afterLastSibling =
        this.elementSpanEnd(body, elementName, lastSibling.index + lastSibling[0].length, lastSibling[0]) +
        eol.length;
      let insertAt: number; // offset dans body
      if (isSorted) {
        const nextSibling = siblings.find(
          (s) => (this.parseAttributes(s[0])["Include"] ?? "").toLowerCase() > include.toLowerCase()
        );
        insertAt = nextSibling ? nextSibling.index : afterLastSibling;
      } else {
        insertAt = afterLastSibling;
      }
      const bodyStart = group.index + group[0].indexOf(body);
      const absolute = bodyStart + insertAt;
      const inserted = nextIsLineStart(content, absolute)
        ? `${newLine}${eol}`
        : `${eol}${newLine}`;
      return { ok: true, content: content.slice(0, absolute) + inserted + content.slice(absolute) };
    }

    // Aucun groupe adapté : créer un ItemGroup avant </Project>
    const closing = content.lastIndexOf("</Project>");
    if (closing === -1) {
      return { ok: false, reason: "balise </Project> introuvable" };
    }
    const block = `  <ItemGroup>${eol}    <${elementName} ${attrText} />${eol}  </ItemGroup>${eol}`;
    return { ok: true, content: content.slice(0, closing) + block + content.slice(closing) };

    function nextIsLineStart(text: string, offset: number): boolean {
      const before = text.slice(Math.max(0, offset - 2), offset);
      return before.endsWith("\n");
    }
  }

  /** Supprime tous les éléments correspondants et leurs lignes ; purge les ItemGroups devenus vides. */
  public removeItemElement(
    content: string,
    elementName: ItemElementName,
    packageId: string
  ): EditResult {
    const elementPattern = new RegExp(`<${elementName}\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:/>|>)`, "gs");
    const toRemove: Array<{ start: number; end: number }> = [];

    for (const match of content.matchAll(elementPattern)) {
      const attributes = this.parseAttributes(match[0]);
      if (attributes["Include"]?.toLowerCase() === packageId.toLowerCase()) {
        const openTagEnd = match.index + match[0].length;
        // Forme bloc (Finding 1) : la suppression doit couvrir tout le span, enfants
        // et balise fermante compris — sans quoi les enfants deviennent orphelins et
        // </elementName> reste seul, ce qui corrompt le MSBuild.
        const end = this.elementSpanEnd(content, elementName, openTagEnd, match[0]);
        toRemove.push({ start: match.index, end });
      }
    }

    if (toRemove.length === 0) {
      return { ok: false, reason: `élément ${elementName} '${packageId}' introuvable` };
    }

    // Supprimer du dernier au premier pour préserver les offsets
    let result = content;
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const { start, end } = toRemove[i];
      // Étendre aux bornes de ligne (y compris l'indentation et le saut final)
      let lineStart = result.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = result.indexOf("\n", end);
      lineEnd = lineEnd === -1 ? result.length : lineEnd + 1;
      result = result.slice(0, lineStart) + result.slice(lineEnd);

      // Purger le ItemGroup ENCLOSANT s'il est devenu vide (et non conditionné)
      const groupPattern = /<ItemGroup(\s(?:"[^"]*"|'[^']*'|[^>"'])*)?>([\s\S]*?)<\/ItemGroup>/g;
      let closestGroup: { start: number; end: number; isConditioned: boolean; body: string } | undefined;
      for (const groupMatch of result.matchAll(groupPattern)) {
        const groupEnd = groupMatch.index + groupMatch[0].length;
        if (groupMatch.index <= lineStart && groupEnd >= lineStart) {
          closestGroup = {
            start: groupMatch.index,
            end: groupEnd,
            isConditioned: !!(groupMatch[1] && /\bCondition\s*=/.test(groupMatch[1])),
            body: groupMatch[2],
          };
          break;
        }
      }

      if (closestGroup && !closestGroup.isConditioned && /^\s*$/.test(closestGroup.body)) {
        let purgeStart = closestGroup.start;
        let purgeEnd = closestGroup.end;

        // Étendre vers l'arrière : inclure l'indentation si la ligne n'a que de l'espace avant la balise
        const prevNewlinePos = result.lastIndexOf("\n", purgeStart - 1);
        const lineBeforeStart = prevNewlinePos + 1;
        const beforeTag = result.slice(lineBeforeStart, purgeStart);
        if (/^[ \t]*$/.test(beforeTag)) {
          purgeStart = lineBeforeStart;
        }

        // Étendre vers l'avant : inclure les espaces/tabs et la fin de ligne
        let afterTagPos = purgeEnd;
        while (afterTagPos < result.length && (result[afterTagPos] === " " || result[afterTagPos] === "\t")) {
          afterTagPos++;
        }
        if (afterTagPos < result.length && result[afterTagPos] === "\r" && afterTagPos + 1 < result.length && result[afterTagPos + 1] === "\n") {
          purgeEnd = afterTagPos + 2;
        } else if (afterTagPos < result.length && result[afterTagPos] === "\n") {
          purgeEnd = afterTagPos + 1;
        }

        result = result.slice(0, purgeStart) + result.slice(purgeEnd);
      }
    }

    return { ok: true, content: result };
  }

  private parseAttributes(elementText: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const attr of elementText.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*(["'])(.*?)\2/gs) ) {
      attributes[attr[1]] = attr[3];
    }
    return attributes;
  }
}
