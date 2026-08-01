import { singleton } from "tsyringe";

export type EditResult = { ok: true; content: string } | { ok: false; reason: string };
export type FoundElement = { start: number; end: number; attributes: Record<string, string> };
export type ItemElementName = "PackageReference" | "PackageVersion";

/** Characters that would let a value escape an XML attribute (MSBuild injection). */
const XML_INJECTION_PATTERN = /["'<>&]/;

/**
 * Textual surgery on MSBuild files: targeted edits that preserve everything
 * outside the edited zone byte for byte (indentation, comments, CRLF, BOM).
 * Pure service: no I/O, string → string.
 */
@singleton()
export class MsBuildTextEditor {
  /**
   * Locates the <elementName ... Include="packageId" ... /> element (id is
   * case-insensitive). Update= elements are ignored (out of scope for v1).
   */
  public findItemElement(
    content: string,
    elementName: ItemElementName,
    packageId: string,
  ): FoundElement | undefined {
    const elementPattern = new RegExp(
      `<${elementName}\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:/>|>)`,
      "gs",
    );
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
   * Extends the end of a found element (the end of the opening tag by default) up to
   * the end of its `</elementName>` closing tag when it is in block form (Finding 1):
   * `<PackageReference Include="X" Version="1"><PrivateAssets>all</PrivateAssets></PackageReference>`.
   * Self-closing elements (`/>`) have no children by construction: their span already
   * stops at `openTagEnd`.
   */
  private elementSpanEnd(
    text: string,
    elementName: string,
    openTagEnd: number,
    openTagText: string,
  ): number {
    if (openTagText.endsWith("/>")) {
      return openTagEnd;
    }
    const closeTag = `</${elementName}>`;
    const closeIndex = text.indexOf(closeTag, openTagEnd);
    return closeIndex === -1 ? openTagEnd : closeIndex + closeTag.length;
  }

  /** Rejects any attribute value carrying a character able to break out of the XML attribute. */
  private validateAttributeValues(attributes: Record<string, string>): EditResult | undefined {
    for (const [key, value] of Object.entries(attributes)) {
      if (XML_INJECTION_PATTERN.test(value)) {
        return {
          ok: false,
          reason: `invalid value for attribute '${key}': forbidden characters (" ' < > &)`,
        };
      }
    }
    return undefined;
  }

  /** Replaces the Version attribute value of EVERY matching element. */
  public setVersionAttribute(
    content: string,
    elementName: ItemElementName,
    packageId: string,
    newVersion: string,
  ): EditResult {
    const invalid = this.validateAttributeValues({ Version: newVersion });
    if (invalid) {
      return invalid;
    }
    const elementPattern = new RegExp(
      `<${elementName}\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:/>|>)`,
      "gs",
    );
    const replacements: Array<{
      elementStart: number;
      elementEnd: number;
      attrStart: number;
      attrEnd: number;
      newValue: string;
    }> = [];

    for (const match of content.matchAll(elementPattern)) {
      const attributes = this.parseAttributes(match[0]);
      if (attributes["Include"]?.toLowerCase() === packageId.toLowerCase()) {
        const elementText = match[0];
        const versionAttr = /(\bVersion\s*=\s*)(["'])(.*?)\2/s.exec(elementText);
        if (!versionAttr) {
          return { ok: false, reason: `element '${packageId}' has no Version attribute` };
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
      return { ok: false, reason: `${elementName} element '${packageId}' not found` };
    }

    // Apply the replacements from last to first to keep the offsets valid
    let result = content;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { attrStart, attrEnd, newValue } = replacements[i];
      const before = result.slice(0, attrStart);
      const after = result.slice(attrEnd);
      result = `${before}${newValue}${after}`;
    }

    return { ok: true, content: result };
  }

  /** Inserts an element; refuses duplicates; never inside a conditioned ItemGroup. */
  public addItemElement(
    content: string,
    elementName: ItemElementName,
    attributes: Record<string, string>,
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
      return { ok: false, reason: `'${include}' is already present` };
    }
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const attrText = Object.entries(attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");

    // Unconditioned groups that already hold elements of the same type
    const groupPattern = /<ItemGroup(\s(?:"[^"]*"|'[^']*'|[^>"'])*)?>([\s\S]*?)<\/ItemGroup>/g;
    for (const group of content.matchAll(groupPattern)) {
      if (group[1] && /\bCondition\s*=/.test(group[1])) {
        continue;
      }
      const body = group[2];
      const siblingPattern = new RegExp(
        `([ \\t]*)<${elementName}\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:/>|>)`,
        "g",
      );
      const siblings = [...body.matchAll(siblingPattern)];
      if (siblings.length === 0) {
        continue;
      }
      const indent = siblings[0][1];
      const newLine = `${indent}<${elementName} ${attrText} />`;
      const includes = siblings.map((s) => this.parseAttributes(s[0])["Include"] ?? "");
      const isSorted = includes.every(
        (id, i) => i === 0 || includes[i - 1].toLowerCase() <= id.toLowerCase(),
      );
      // Position right after the previous sibling: the opening tag for a self-closing
      // form, but after the CLOSING tag for a block form — otherwise the insertion
      // would land inside the previous element (Finding 1).
      const lastSibling = siblings[siblings.length - 1];
      const afterLastSibling =
        this.elementSpanEnd(
          body,
          elementName,
          lastSibling.index + lastSibling[0].length,
          lastSibling[0],
        ) + eol.length;
      let insertAt: number; // offset dans body
      if (isSorted) {
        const nextSibling = siblings.find(
          (s) =>
            (this.parseAttributes(s[0])["Include"] ?? "").toLowerCase() > include.toLowerCase(),
        );
        insertAt = nextSibling ? nextSibling.index : afterLastSibling;
      } else {
        insertAt = afterLastSibling;
      }
      const bodyStart = group.index + group[0].indexOf(body);
      const absolute = bodyStart + insertAt;
      const inserted = nextIsLineStart(content, absolute) ? `${newLine}${eol}` : `${eol}${newLine}`;
      return { ok: true, content: content.slice(0, absolute) + inserted + content.slice(absolute) };
    }

    // No suitable group: create an ItemGroup before </Project>
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

  /** Removes every matching element and its lines; purges ItemGroups left empty. */
  public removeItemElement(
    content: string,
    elementName: ItemElementName,
    packageId: string,
  ): EditResult {
    const elementPattern = new RegExp(
      `<${elementName}\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:/>|>)`,
      "gs",
    );
    const toRemove: Array<{ start: number; end: number }> = [];

    for (const match of content.matchAll(elementPattern)) {
      const attributes = this.parseAttributes(match[0]);
      if (attributes["Include"]?.toLowerCase() === packageId.toLowerCase()) {
        const openTagEnd = match.index + match[0].length;
        // Block form (Finding 1): the removal must cover the whole span, children and
        // closing tag included — otherwise the children are orphaned and
        // </elementName> is left alone, which corrupts the MSBuild file.
        const end = this.elementSpanEnd(content, elementName, openTagEnd, match[0]);
        toRemove.push({ start: match.index, end });
      }
    }

    if (toRemove.length === 0) {
      return { ok: false, reason: `${elementName} element '${packageId}' not found` };
    }

    // Remove from last to first to keep the offsets valid
    let result = content;
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const { start, end } = toRemove[i];
      // Extend to the line boundaries (including indentation and the trailing newline)
      let lineStart = result.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = result.indexOf("\n", end);
      lineEnd = lineEnd === -1 ? result.length : lineEnd + 1;
      result = result.slice(0, lineStart) + result.slice(lineEnd);

      // Purge the ENCLOSING ItemGroup if it became empty (and is not conditioned)
      const groupPattern = /<ItemGroup(\s(?:"[^"]*"|'[^']*'|[^>"'])*)?>([\s\S]*?)<\/ItemGroup>/g;
      let closestGroup:
        { start: number; end: number; isConditioned: boolean; body: string } | undefined;
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

        // Extend backwards: include the indentation if the line holds only whitespace before the tag
        const prevNewlinePos = result.lastIndexOf("\n", purgeStart - 1);
        const lineBeforeStart = prevNewlinePos + 1;
        const beforeTag = result.slice(lineBeforeStart, purgeStart);
        if (/^[ \t]*$/.test(beforeTag)) {
          purgeStart = lineBeforeStart;
        }

        // Extend forwards: include spaces/tabs and the end of line
        let afterTagPos = purgeEnd;
        while (
          afterTagPos < result.length &&
          (result[afterTagPos] === " " || result[afterTagPos] === "\t")
        ) {
          afterTagPos++;
        }
        if (
          afterTagPos < result.length &&
          result[afterTagPos] === "\r" &&
          afterTagPos + 1 < result.length &&
          result[afterTagPos + 1] === "\n"
        ) {
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
    for (const attr of elementText.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*(["'])(.*?)\2/gs)) {
      attributes[attr[1]] = attr[3];
    }
    return attributes;
  }
}
