import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  LoaderCircle,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  rgb,
} from "pdf-lib";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./styles.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/*                              General helpers                               */
/* -------------------------------------------------------------------------- */

const sleep = () =>
    new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });

const clamp = (value, minimum, maximum) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, number));
};

const normalizeLine = (value = "") =>
    value
        .replace(/\s+/g, " ")
        .replace(/[–—]/g, "-")
        .trim();

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes)) {
    return "";
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const copyArrayBuffer = (arrayBuffer) => arrayBuffer.slice(0);

/* -------------------------------------------------------------------------- */
/*                       Paper color & thickness presets                      */
/* -------------------------------------------------------------------------- */

const DEFAULT_BACKGROUND_COLOR = "#F1F1F1";

const BACKGROUND_PRESETS = [
  { id: "soft-white", label: "Soft white", hex: "#F1F1F1" },
  { id: "white", label: "Pure white", hex: "#FFFFFF" },
  { id: "warm-paper", label: "Warm paper", hex: "#F5F1E6" },
  { id: "grey", label: "Cool grey", hex: "#DCDFE4" },
  { id: "dark-grey", label: "Dark grey", hex: "#26272B" },
  { id: "charcoal", label: "Charcoal", hex: "#16171A" },
];

const LIGHT_PATTERN_PRESETS = [
  { id: "slate-blue", label: "Greyish blue", hex: "#7E94AB" },
  { id: "dark-gray", label: "Dark gray", hex: "#222428" },
  { id: "soft-purple", label: "Soft purple", hex: "#9485B8" },
  { id: "subtle-gray", label: "Subtle gray", hex: "#A4AAB3" },
  { id: "sage", label: "Muted sage", hex: "#7E9B8C" },
  { id: "warm-taupe", label: "Warm taupe", hex: "#AD9A86" },
];

const DARK_PATTERN_PRESETS = [
  { id: "slate-blue", label: "Greyish blue", hex: "#6E87A1" },
  { id: "dark-gray", label: "Off-white", hex: "#D4D7DD" },
  { id: "soft-purple", label: "Soft purple", hex: "#9D8DC4" },
  { id: "subtle-gray", label: "Subtle gray", hex: "#545963" },
  { id: "sage", label: "Muted sage", hex: "#719684" },
  { id: "warm-taupe", label: "Warm sand", hex: "#A89680" },
];

const THICKNESS_OPTIONS = [
  {
    value: "thin",
    label: "thin",
    lineWidthPt: 0.25,
    dotRadiusPt: 0.6,
    previewLinePx: 1,
    previewAlpha: 0.72,
    previewDotPx: 1,
  },
  {
    value: "regular",
    label: "regular",
    lineWidthPt: 0.45,
    dotRadiusPt: 0.9,
    previewLinePx: 1.25,
    previewAlpha: 0.94,
    previewDotPx: 1.4,
  },
  {
    value: "medium",
    label: "medium",
    lineWidthPt: 0.8,
    dotRadiusPt: 1.3,
    previewLinePx: 1.75,
    previewAlpha: 1,
    previewDotPx: 1.9,
  },
  {
    value: "thick",
    label: "thick",
    lineWidthPt: 1.25,
    dotRadiusPt: 1.8,
    previewLinePx: 2.5,
    previewAlpha: 1,
    previewDotPx: 2.5,
  },
];

const normalizeHex = (value = "") => {
  const cleaned = String(value).trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return `#${cleaned
        .split("")
        .map((channel) => channel + channel)
        .join("")
        .toUpperCase()}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }

  return null;
};

const hexToRgb255 = (hex) => {
  const normalized = normalizeHex(hex) ?? "#000000";

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
};

const hexToRgba = (hex, alpha = 1) => {
  const { r, g, b } = hexToRgb255(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const hexToPdfRgb = (hex) => {
  const { r, g, b } = hexToRgb255(hex);
  return rgb(r / 255, g / 255, b / 255);
};

const getRelativeLuminance = (hex) => {
  const { r, g, b } = hexToRgb255(hex);
  const toLinear = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (
      0.2126 * toLinear(r) +
      0.7152 * toLinear(g) +
      0.0722 * toLinear(b)
  );
};

/*
 * WCAG contrast midpoint (~0.179) splits colors where white ink reads better
 * than dark ink.
 */
const isDarkColor = (hex) => getRelativeLuminance(hex) < 0.18;

const getContrastRatio = (hexA, hexB) => {
  const luminanceA = getRelativeLuminance(hexA);
  const luminanceB = getRelativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  return (lighter + 0.05) / (darker + 0.05);
};

/* -------------------------------------------------------------------------- */
/*                           Heading detection logic                           */
/* -------------------------------------------------------------------------- */

function createHeadingCandidate(line, pageIndex) {
  const normalized = normalizeLine(line);

  const chapterMatch = normalized.match(
      /^Hoofdstuk\s+(\d{1,2})\s*[:.)-]?\s*(.*)$/i,
  );

  if (chapterMatch) {
    const chapterNumber = chapterMatch[1];
    const title =
        normalizeLine(chapterMatch[2]) || `Hoofdstuk ${chapterNumber}`;

    return {
      id: `page-${pageIndex + 1}-chapter-${chapterNumber}`,
      page: pageIndex + 1,
      level: 1,
      code: chapterNumber,
      title,
      enabled: true,
    };
  }

  const sectionMatch = normalized.match(
      /^(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?(?:\s*\/\s*(\d{1,2}))?\s*[:.)-]?\s*(.*)$/,
  );

  if (!sectionMatch) {
    return null;
  }

  const [, chapter, section, subsection, combinedSection, rawTitle] =
      sectionMatch;

  if (
      Number(chapter) > 30 ||
      Number(section) > 30 ||
      (subsection && Number(subsection) > 30)
  ) {
    return null;
  }

  const title = normalizeLine(rawTitle);

  if (!title || /^[\d.,\s€$%]+$/.test(title)) {
    return null;
  }

  const code =
      `${chapter}.${section}` +
      (subsection ? `.${subsection}` : "") +
      (combinedSection ? `/${combinedSection}` : "");

  return {
    id: `page-${pageIndex + 1}-section-${code}`,
    page: pageIndex + 1,
    level: subsection ? 3 : 2,
    code,
    title,
    enabled: true,
  };
}

function groupTextItemsIntoLines(items) {
  const lines = [];

  for (const item of items) {
    const tolerance = Math.max(3, item.size * 0.28);

    let existingLine = lines.find(
        (line) => Math.abs(line.y - item.y) <= tolerance,
    );

    if (!existingLine) {
      existingLine = {
        y: item.y,
        size: item.size,
        parts: [],
      };

      lines.push(existingLine);
    }

    existingLine.parts.push(item);
    existingLine.size = Math.max(existingLine.size, item.size);
  }

  return lines
      .map((line) => ({
        ...line,
        text: normalizeLine(
            line.parts
                .sort((leftItem, rightItem) => leftItem.x - rightItem.x)
                .map((item) => item.text)
                .join(" "),
        ),
      }))
      .filter((line) => line.text)
      .sort((leftLine, rightLine) => rightLine.y - leftLine.y);
}

async function extractExistingOutline(
    pdfBytes,
    onProgress = () => {},
) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(copyArrayBuffer(pdfBytes)),
    disableFontFace: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;

  try {
    const sourceOutline = await pdf.getOutline();

    console.log("Raw PDF outline:", sourceOutline);

    if (
        !Array.isArray(sourceOutline) ||
        sourceOutline.length === 0
    ) {
      return [];
    }

    /*
     * Build a page-reference lookup table.
     *
     * Some PDFs provide outline destinations as indirect PDF references.
     * Resolving all page references once gives us a reliable fallback when
     * pdf.getPageIndex() cannot resolve a particular destination directly.
     */
    const pageReferenceMap = new Map();

    for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber += 1
    ) {
      const page = await pdf.getPage(pageNumber);
      const reference = page.ref;

      if (reference) {
        const referenceKey =
            `${reference.num ?? ""}:${reference.gen ?? 0}`;

        pageReferenceMap.set(
            referenceKey,
            pageNumber,
        );
      }

      if (pageNumber % 25 === 0) {
        await sleep();
      }
    }

    async function resolveDestination(
        rawDestination,
    ) {
      if (!rawDestination) {
        return null;
      }

      let destination = rawDestination;

      /*
       * Named destinations appear as strings. Resolve the name first.
       */
      if (typeof destination === "string") {
        try {
          destination =
              await pdf.getDestination(destination);
        } catch (error) {
          console.warn(
              "Could not resolve named destination:",
              rawDestination,
              error,
          );

          return null;
        }
      }

      if (
          !Array.isArray(destination) ||
          destination.length === 0
      ) {
        return null;
      }

      const pageDestination = destination[0];

      /*
       * Most outlines use an indirect page reference.
       */
      if (
          pageDestination &&
          typeof pageDestination === "object"
      ) {
        try {
          const pageIndex =
              await pdf.getPageIndex(pageDestination);

          if (
              Number.isInteger(pageIndex) &&
              pageIndex >= 0
          ) {
            return pageIndex + 1;
          }
        } catch (error) {
          /*
           * Fall through to manual reference matching.
           */
          console.warn(
              "Direct page-index resolution failed:",
              pageDestination,
              error,
          );
        }

        const referenceKey =
            `${pageDestination.num ?? ""}:${
                pageDestination.gen ?? 0
            }`;

        if (pageReferenceMap.has(referenceKey)) {
          return pageReferenceMap.get(referenceKey);
        }
      }

      /*
       * Some PDF.js versions expose a direct zero-based page index.
       */
      if (
          Number.isInteger(pageDestination) &&
          pageDestination >= 0 &&
          pageDestination < pdf.numPages
      ) {
        return pageDestination + 1;
      }

      return null;
    }

    const extractedOutline = [];
    let processedItems = 0;

    async function walkOutline(
        outlineItems,
        level = 1,
    ) {
      for (const item of outlineItems) {
        processedItems += 1;

        const pageNumber =
            await resolveDestination(item.dest);

        /*
         * Preserve containers even when their destination cannot be
         * resolved, provided a child destination can be used later.
         */
        if (pageNumber !== null) {
          extractedOutline.push({
            id: `existing-outline-${processedItems}`,
            page: pageNumber,
            level: Math.min(
                6,
                Math.max(1, level),
            ),
            code: "",
            title:
                normalizeLine(item.title) ||
                `Page ${pageNumber}`,
            enabled: true,
          });
        } else {
          console.warn(
              "Outline destination was not resolved:",
              {
                title: item.title,
                destination: item.dest,
                url: item.url,
              },
          );
        }

        if (
            Array.isArray(item.items) &&
            item.items.length > 0
        ) {
          await walkOutline(
              item.items,
              level + 1,
          );
        }

        onProgress(processedItems);

        if (processedItems % 20 === 0) {
          await sleep();
        }
      }
    }

    await walkOutline(sourceOutline, 1);

    console.log(
        `Resolved ${extractedOutline.length} outline items`,
        extractedOutline,
    );

    /*
     * Keep the source order. Do not sort by page number because the order
     * and nesting supplied by the PDF define the bookmark hierarchy.
     */
    return extractedOutline;
  } finally {
    try {
      if (
          typeof loadingTask.destroy === "function"
      ) {
        await loadingTask.destroy();
      }
    } catch (cleanupError) {
      console.warn(
          "PDF.js cleanup did not complete:",
          cleanupError,
      );
    }
  }
}

async function detectHeadings(pdfBytes, onProgress) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(copyArrayBuffer(pdfBytes)),
    disableFontFace: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });


  const pdf = await loadingTask.promise;

  const detected = [];
  const seenCodes = new Set();

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });

      const textItems = textContent.items
          .filter((item) => item.str && item.str.trim())
          .map((item) => ({
            text: item.str.trim(),
            x: Number(item.transform?.[4] ?? 0),
            y: Number(item.transform?.[5] ?? 0),
            size:
                Math.abs(Number(item.transform?.[0] ?? 0)) ||
                Number(item.height ?? 0) ||
                1,
          }));

      const lines = groupTextItemsIntoLines(textItems);
      const fontSizes = textItems
          .map((item) => item.size)
          .filter(Number.isFinite)
          .sort((left, right) => left - right);

      const medianFontSize =
          fontSizes[Math.floor(fontSizes.length / 2)] || 10;

      /*
       * Only evaluate the upper part of the page. This prevents figures,
       * formulas, exercise numbers and page footers from becoming headings.
       */
      const candidateLines = lines
          .filter((line) => line.y >= viewport.height * 0.47)
          .slice(0, 10);

      for (
          let lineIndex = 0;
          lineIndex < candidateLines.length;
          lineIndex += 1
      ) {
        const line = candidateLines[lineIndex];
        let candidate = createHeadingCandidate(line.text, pageNumber - 1);

        if (!candidate) {
          continue;
        }

        const appearsNearTop = line.y >= viewport.height * 0.58;
        const appearsProminent = line.size >= medianFontSize * 1.05;

        if (!appearsNearTop && !appearsProminent) {
          continue;
        }

        /*
         * Join a short wrapped title with the line immediately below it.
         */
        if (
            candidate.title.length < 32 &&
            candidateLines[lineIndex + 1]
        ) {
          const continuationLine = candidateLines[lineIndex + 1];
          const continuation = normalizeLine(continuationLine.text);

          const continuationIsAnotherHeading =
              createHeadingCandidate(continuation, pageNumber - 1);

          const continuationLooksLikeBodyText =
              /^[•▪◦\-]/.test(continuation) ||
              continuation.length > 100;

          if (
              continuation &&
              !continuationIsAnotherHeading &&
              !continuationLooksLikeBodyText
          ) {
            candidate = {
              ...candidate,
              title: `${candidate.title} ${continuation}`.trim(),
            };
          }
        }

        const normalizedCode = candidate.code.toLowerCase();

        /*
         * One outline destination per numbered section. Repeated slide titles
         * are ignored after the first occurrence.
         */
        if (!seenCodes.has(normalizedCode)) {
          seenCodes.add(normalizedCode);
          detected.push(candidate);
        }
      }

      onProgress(Math.round((pageNumber / pdf.numPages) * 100));

      if (pageNumber % 10 === 0) {
        await sleep();
      }
    }
  } finally {
    if (typeof loadingTask.destroy === "function") {
      await loadingTask.destroy();
    }
  }

  return detected.sort(
      (left, right) =>
          left.page - right.page ||
          left.level - right.level ||
          left.code.localeCompare(right.code, undefined, { numeric: true }),
  );
}

/* -------------------------------------------------------------------------- */
/*                         Low-level PDF outline writer                        */
/* -------------------------------------------------------------------------- */

function removeExistingOutline(pdfDocument) {
  /*
   * Replacing the catalog reference prevents the old outline from appearing.
   * Unreferenced old outline objects may remain in the PDF file but are not
   * reachable by PDF readers.
   */
  pdfDocument.catalog.delete(PDFName.of("Outlines"));
}

function installOutlines(pdfDocument, headings) {
  const enabledHeadings = headings.filter(
      (heading) =>
          heading.enabled &&
          heading.title.trim() &&
          heading.page >= 1 &&
          heading.page <= pdfDocument.getPageCount(),
  );

  if (!enabledHeadings.length) {
    return;
  }

  const context = pdfDocument.context;
  const pages = pdfDocument.getPages();
  const pageReferences = pages.map((page) => page.ref);

  const rootReference = context.nextRef();
  const headingReferences = enabledHeadings.map(() => context.nextRef());

  /*
   * A child belongs to the closest preceding outline item with a lower level.
   * Example:
   *   Chapter 3, level 1
   *     3.5, level 2
   *       3.5.2, level 3
   */
  const parentIndices = enabledHeadings.map((heading, headingIndex) => {
    for (
        let previousIndex = headingIndex - 1;
        previousIndex >= 0;
        previousIndex -= 1
    ) {
      if (
          enabledHeadings[previousIndex].level < heading.level
      ) {
        return previousIndex;
      }
    }

    return -1;
  });

  const childrenByParent = new Map();

  parentIndices.forEach((parentIndex, headingIndex) => {
    if (!childrenByParent.has(parentIndex)) {
      childrenByParent.set(parentIndex, []);
    }

    childrenByParent.get(parentIndex).push(headingIndex);
  });

  enabledHeadings.forEach((heading, headingIndex) => {
    const parentIndex = parentIndices[headingIndex];
    const siblings = childrenByParent.get(parentIndex) ?? [];
    const siblingPosition = siblings.indexOf(headingIndex);
    const children = childrenByParent.get(headingIndex) ?? [];

    const destination = PDFArray.withContext(context);
    destination.push(pageReferences[heading.page - 1]);
    destination.push(PDFName.of("Fit"));

    const outlineItemMap = new Map();

    const visibleTitle = `${heading.code ? `${heading.code} ` : ""}${
        heading.title
    }`.trim();

    outlineItemMap.set(
        PDFName.of("Title"),
        PDFString.of(visibleTitle),
    );

    outlineItemMap.set(
        PDFName.of("Parent"),
        parentIndex < 0
            ? rootReference
            : headingReferences[parentIndex],
    );

    outlineItemMap.set(PDFName.of("Dest"), destination);

    if (siblingPosition > 0) {
      outlineItemMap.set(
          PDFName.of("Prev"),
          headingReferences[siblings[siblingPosition - 1]],
      );
    }

    if (siblingPosition < siblings.length - 1) {
      outlineItemMap.set(
          PDFName.of("Next"),
          headingReferences[siblings[siblingPosition + 1]],
      );
    }

    if (children.length) {
      outlineItemMap.set(
          PDFName.of("First"),
          headingReferences[children[0]],
      );

      outlineItemMap.set(
          PDFName.of("Last"),
          headingReferences[children[children.length - 1]],
      );

      /*
       * A positive Count opens the node initially. Change this to a negative
       * number if you prefer collapsed chapter nodes.
       */
      outlineItemMap.set(
          PDFName.of("Count"),
          PDFNumber.of(children.length),
      );
    }

    context.assign(
        headingReferences[headingIndex],
        PDFDict.fromMapWithContext(outlineItemMap, context),
    );
  });

  const rootItems = childrenByParent.get(-1) ?? [];

  if (!rootItems.length) {
    return;
  }

  const rootMap = new Map();

  rootMap.set(PDFName.of("Type"), PDFName.of("Outlines"));
  rootMap.set(
      PDFName.of("First"),
      headingReferences[rootItems[0]],
  );
  rootMap.set(
      PDFName.of("Last"),
      headingReferences[rootItems[rootItems.length - 1]],
  );
  rootMap.set(
      PDFName.of("Count"),
      PDFNumber.of(enabledHeadings.length),
  );

  context.assign(
      rootReference,
      PDFDict.fromMapWithContext(rootMap, context),
  );

  pdfDocument.catalog.set(PDFName.of("Outlines"), rootReference);
  pdfDocument.catalog.set(
      PDFName.of("PageMode"),
      PDFName.of("UseOutlines"),
  );
}

/* -------------------------------------------------------------------------- */
/*                         Annotation movement helper                          */
/* -------------------------------------------------------------------------- */

function translatePageAnnotations(page, offsetX, offsetY) {
  /*
   * Current pdf-lib releases provide translateAnnotations. The feature check
   * lets the rest of the document continue when reading an unusual PDF.
   */
  if (typeof page.translateAnnotations === "function") {
    try {
      page.translateAnnotations(offsetX, offsetY);
    } catch (error) {
      console.warn("Some annotations could not be translated.", error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                              React components                              */
/* -------------------------------------------------------------------------- */

function MarginField({
                       label,
                       value,
                       onChange,
                       suffix = "%",
                       minimum = 0,
                       maximum = 100,
                     }) {
  return (
      <label className="margin-field">
        <span className="margin-field__label">{label}</span>

        <span className="margin-field__value">
          <input
              type="number"
              min={minimum}
              max={maximum}
              value={value}
              aria-label={`${label} margin`}
              onChange={(event) =>
                  onChange(clamp(event.target.value, minimum, maximum))
              }
          />
          <span className="margin-field__suffix">{suffix}</span>
        </span>
      </label>
  );
}

function Segmented({ label, options, value, onChange, disabled = false }) {
  return (
      <div className="control-row">
        <span className="control-row__label">{label}</span>

        <div
            className={`segmented ${disabled ? "is-disabled" : ""}`}
            role="radiogroup"
            aria-label={label}
        >
          {options.map((option) => (
              <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={value === option.value}
                  className={value === option.value ? "is-active" : ""}
                  disabled={disabled}
                  onClick={() => onChange(option.value)}
              >
                {option.label}
              </button>
          ))}
        </div>
      </div>
  );
}

function ColorSelector({
                         label,
                         presets,
                         value,
                         onChange,
                         disabled = false,
                         customLabel = "Custom color",
                         hint = "",
                       }) {
  const normalizedValue = normalizeHex(value) ?? "#000000";
  const isCustom = !presets.some(
      (preset) => preset.hex.toUpperCase() === normalizedValue,
  );

  return (
      <div className="control-row">
        <span className="control-row__label">
          {label}
          {hint ? <small className="control-row__hint">{hint}</small> : null}
        </span>

        <div
            className={`color-bar ${disabled ? "is-disabled" : ""}`}
            role="group"
            aria-label={label}
        >
          <div className="color-swatches">
            {presets.map((preset) => {
              const isActive =
                  preset.hex.toUpperCase() === normalizedValue;

              return (
                  <button
                      key={preset.id}
                      type="button"
                      className={`color-swatch ${isActive ? "is-active" : ""}`}
                      style={{ "--swatch": preset.hex }}
                      disabled={disabled}
                      aria-label={`${preset.label} (${preset.hex})`}
                      aria-pressed={isActive}
                      title={`${preset.label} · ${preset.hex}`}
                      onClick={() => onChange(preset.hex)}
                  />
              );
            })}
          </div>

          <label
              className={`color-custom ${isCustom ? "is-active" : ""} ${
                  disabled ? "is-disabled" : ""
              }`}
              title={`${customLabel} · ${normalizedValue}`}
          >
            <input
                type="color"
                className="color-custom__input"
                value={normalizedValue}
                disabled={disabled}
                aria-label={customLabel}
                onChange={(event) => onChange(event.target.value)}
            />
            <span
                className="color-custom__dot"
                style={{ "--swatch": normalizedValue }}
                aria-hidden="true"
            />
            <span className="color-custom__hex">{normalizedValue}</span>
          </label>
        </div>
      </div>
  );
}

function Toggle({ enabled, onChange, label, description }) {
  return (
      <div className="toggle-row">
        <div className="toggle-row__text">
          <span>{label}</span>
          <small>{description}</small>
        </div>

        <button
            type="button"
            className={`switch ${enabled ? "is-on" : ""}`}
            role="switch"
            aria-checked={enabled}
            aria-label={label}
            onClick={() => onChange(!enabled)}
        >
          <span className="switch__knob" />
        </button>
      </div>
  );
}

function TileHead({ id, label, children }) {
  return (
      <header className="tile-head">
        <h2 id={id}>{label}</h2>
        {children ? <span className="tile-head__meta">{children}</span> : null}
      </header>
  );
}

function OutlineEditor({ headings, setHeadings }) {
  const updateHeading = (headingId, changes) => {
    setHeadings((currentHeadings) =>
        currentHeadings.map((heading) =>
            heading.id === headingId
                ? { ...heading, ...changes }
                : heading,
        ),
    );
  };

  const setAll = (enabled) => {
    setHeadings((currentHeadings) =>
        currentHeadings.map((heading) => ({
          ...heading,
          enabled,
        })),
    );
  };

  return (
      <>
        <div className="outline-toolbar">
          <button
              type="button"
              className="text-link"
              onClick={() => setAll(true)}
          >
            enable all
          </button>
          <button
              type="button"
              className="text-link"
              onClick={() => setAll(false)}
          >
            disable all
          </button>
        </div>

        <ul className="outline-list">
          {headings.map((heading) => (
              <li
                  key={heading.id}
                  className={[
                    "outline-row",
                    `level-${heading.level}`,
                    heading.enabled ? "" : "is-disabled",
                  ]
                      .filter(Boolean)
                      .join(" ")}
              >
                <button
                    type="button"
                    className={`checkbox ${heading.enabled ? "is-checked" : ""}`}
                    role="checkbox"
                    aria-checked={heading.enabled}
                    aria-label={
                      heading.enabled
                          ? "Disable bookmark"
                          : "Enable bookmark"
                    }
                    onClick={() =>
                        updateHeading(heading.id, {
                          enabled: !heading.enabled,
                        })
                    }
                >
                  {heading.enabled ? <Check size={10} strokeWidth={3.5} /> : null}
                </button>

                <input
                    className="outline-input outline-input--code"
                    aria-label="Bookmark section number"
                    value={heading.code}
                    placeholder="—"
                    onChange={(event) =>
                        updateHeading(heading.id, {
                          code: event.target.value,
                        })
                    }
                />

                <input
                    className="outline-input outline-input--title"
                    aria-label="Bookmark title"
                    value={heading.title}
                    onChange={(event) =>
                        updateHeading(heading.id, {
                          title: event.target.value,
                        })
                    }
                />

                <select
                    className="outline-input outline-input--level"
                    aria-label="Bookmark level"
                    value={heading.level}
                    onChange={(event) =>
                        updateHeading(heading.id, {
                          level: Number(event.target.value),
                        })
                    }
                >
                  <option value="1">L1</option>
                  <option value="2">L2</option>
                  <option value="3">L3</option>
                  <option value="4">L4</option>
                  <option value="5">L5</option>
                  <option value="6">L6</option>
                </select>

                <label className="outline-page">
                  <span aria-hidden="true">p.</span>
                  <input
                      className="outline-input outline-input--page"
                      aria-label="Bookmark page"
                      type="number"
                      min="1"
                      value={heading.page}
                      onChange={(event) =>
                          updateHeading(heading.id, {
                            page: Math.max(
                                1,
                                Number(event.target.value) || 1,
                            ),
                          })
                      }
                  />
                </label>
              </li>
          ))}
        </ul>
      </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Main app                                  */
/* -------------------------------------------------------------------------- */

export default function App() {
  const fileInputRef = useRef(null);

  const [sourceFile, setSourceFile] = useState(null);
  const [sourceBytes, setSourceBytes] = useState(null);
  const [pageCount, setPageCount] = useState(0);

  const [leftMargin, setLeftMargin] = useState(10);
  const [rightMargin, setRightMargin] = useState(40);
  const [topMargin, setTopMargin] = useState(10);
  const [bottomMargin, setBottomMargin] = useState(10);

  const [paperStyle, setPaperStyle] = useState("grid");
  const [paperSpacing, setPaperSpacing] = useState("5");
  const [patternThickness, setPatternThickness] = useState("regular");
  const [backgroundColor, setBackgroundColor] = useState(
      DEFAULT_BACKGROUND_COLOR,
  );
  const [patternColor, setPatternColor] = useState(
      LIGHT_PATTERN_PRESETS[0].hex,
  );
  const [showBorder, setShowBorder] = useState(false);

  const [outlineMode, setOutlineMode] = useState("detect");
  const [headings, setHeadings] = useState([]);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("info");

  const [resultUrl, setResultUrl] = useState("");
  const [resultName, setResultName] = useState("");

  useEffect(() => {
    return () => {
      if (resultUrl) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [resultUrl]);

  const darkBackground = isDarkColor(backgroundColor);

  const activePatternPresets = darkBackground
      ? DARK_PATTERN_PRESETS
      : LIGHT_PATTERN_PRESETS;

  const activeThickness = useMemo(
      () =>
          THICKNESS_OPTIONS.find(
              (option) => option.value === patternThickness,
          ) ?? THICKNESS_OPTIONS[1],
      [patternThickness],
  );

  const borderColorHex = darkBackground ? "#8A94A0" : "#4D5966";

  const pageAspect = useMemo(
      () => ({
        width:
            290 *
            (1 + (leftMargin + rightMargin) / 100),
        height:
            210 *
            (1 + (topMargin + bottomMargin) / 100),
      }),
      [
        leftMargin,
        rightMargin,
        topMargin,
        bottomMargin,
      ],
  );

  const previewPattern = useMemo(() => {
    const baseStyle = {
      backgroundColor,
    };

    if (paperStyle === "blank") {
      return baseStyle;
    }

    const previewSpacingPx =
        paperSpacing === "2.5"
            ? 10
            : paperSpacing === "10"
                ? 24
                : 15;

    const stroke = hexToRgba(
        patternColor,
        activeThickness.previewAlpha,
    );

    if (paperStyle === "lines") {
      return {
        ...baseStyle,
        backgroundImage: `linear-gradient(${stroke} ${activeThickness.previewLinePx}px, transparent ${activeThickness.previewLinePx}px)`,
        backgroundSize: `${previewSpacingPx}px ${previewSpacingPx}px`,
      };
    }

    if (paperStyle === "dots") {
      const dotRadius = activeThickness.previewDotPx;
      return {
        ...baseStyle,
        backgroundImage: `radial-gradient(circle, ${stroke} ${dotRadius}px, transparent ${
            dotRadius + 0.35
        }px)`,
        backgroundSize: `${previewSpacingPx}px ${previewSpacingPx}px`,
      };
    }

    return {
      ...baseStyle,
      backgroundImage: `linear-gradient(${stroke} ${activeThickness.previewLinePx}px, transparent ${activeThickness.previewLinePx}px), linear-gradient(90deg, ${stroke} ${activeThickness.previewLinePx}px, transparent ${activeThickness.previewLinePx}px)`,
      backgroundSize: `${previewSpacingPx}px ${previewSpacingPx}px`,
    };
  }, [
    activeThickness,
    backgroundColor,
    paperSpacing,
    paperStyle,
    patternColor,
  ]);

  const originalPagePosition = useMemo(() => {
    const totalHorizontal = 100 + leftMargin + rightMargin;
    const totalVertical = 100 + topMargin + bottomMargin;

    return {
      left: `${(leftMargin / totalHorizontal) * 100}%`,
      right: `${(rightMargin / totalHorizontal) * 100}%`,
      top: `${(topMargin / totalVertical) * 100}%`,
      bottom: `${(bottomMargin / totalVertical) * 100}%`,
      border: showBorder
          ? `1px solid ${borderColorHex}`
          : "none",
    };
  }, [
    borderColorHex,
    bottomMargin,
    leftMargin,
    rightMargin,
    showBorder,
    topMargin,
  ]);

  const clearResult = () => {
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
    }

    setResultUrl("");
    setResultName("");
  };

  const handleBackgroundColorChange = (nextColor) => {
    const normalized = normalizeHex(nextColor);

    if (!normalized) {
      return;
    }

    const wasDark = isDarkColor(backgroundColor);
    const willBeDark = isDarkColor(normalized);

    setBackgroundColor(normalized);
    clearResult();

    if (wasDark !== willBeDark) {
      const previousPalette = wasDark
          ? DARK_PATTERN_PRESETS
          : LIGHT_PATTERN_PRESETS;
      const nextPalette = willBeDark
          ? DARK_PATTERN_PRESETS
          : LIGHT_PATTERN_PRESETS;

      const matchedPreset = previousPalette.find(
          (preset) =>
              preset.hex.toUpperCase() === patternColor.toUpperCase(),
      );

      if (matchedPreset) {
        const counterpart = nextPalette.find(
            (preset) => preset.id === matchedPreset.id,
        );
        setPatternColor(
            counterpart ? counterpart.hex : nextPalette[0].hex,
        );
      } else if (getContrastRatio(patternColor, normalized) < 1.6) {
        setPatternColor(nextPalette[0].hex);
      }
    }
  };

  const handlePatternColorChange = (nextColor) => {
    const normalized = normalizeHex(nextColor);

    if (!normalized) {
      return;
    }

    setPatternColor(normalized);
    clearResult();
  };

  const handleThicknessChange = (nextThickness) => {
    setPatternThickness(nextThickness);
    clearResult();
  };

  const resetFile = () => {
    clearResult();
    setSourceFile(null);
    setSourceBytes(null);
    setPageCount(0);
    setHeadings([]);
    setBusy(false);
    setStage("");
    setProgress(0);
    setStatus("");
    setStatusType("info");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const scanHeadings = async (bytes) => {
    setStage("Detecting chapters");
    setStatus(
        "Scanning titles such as 1.1, 2.3, 4.4.2 and Hoofdstuk 6…",
    );
    setStatusType("info");
    setProgress(0);

    const detectedHeadings = await detectHeadings(
        bytes,
        setProgress,
    );

    setHeadings(detectedHeadings);

    return detectedHeadings;
  };

  const openPdf = async (selectedFile) => {
    if (!selectedFile) {
      return;
    }

    const looksLikePdf =
        selectedFile.type === "application/pdf" ||
        selectedFile.name.toLowerCase().endsWith(".pdf");

    if (!looksLikePdf) {
      setStatus("Select a PDF file.");
      setStatusType("error");
      return;
    }

    resetFile();

    setSourceFile(selectedFile);
    setBusy(true);
    setStage("Reading PDF");
    setStatus("Opening the PDF locally…");
    setStatusType("info");
    setProgress(2);

    try {
      const fileBytes = await selectedFile.arrayBuffer();

      const probeDocument = await PDFDocument.load(
          copyArrayBuffer(fileBytes),
          {
            ignoreEncryption: false,
            updateMetadata: false,
          },
      );

      setSourceBytes(fileBytes);
      setPageCount(probeDocument.getPageCount());
      setProgress(10);

      if (outlineMode === "detect") {
        const detectedHeadings = await scanHeadings(
            copyArrayBuffer(fileBytes),
        );

        setStatus(
            `Ready. Detected ${detectedHeadings.length} chapter and section headings.`,
        );
      } else {
        setStage("Reading existing outline");
        setStatus("Reading bookmarks from the original PDF…");
        setProgress(15);

        const existingOutline =
            await extractExistingOutline(
                copyArrayBuffer(fileBytes),
            );

        setHeadings(existingOutline);

        if (existingOutline.length > 0) {
          setStatus(
              `Ready. Found ${existingOutline.length} existing outline entries.`,
          );
        } else {
          setStatus(
              "Ready. This PDF does not contain an existing outline.",
          );
        }
      }

      setStatusType("info");
    } catch (error) {
      console.error(error);

      setSourceBytes(null);
      setPageCount(0);
      setHeadings([]);
      setStatus(
          `Could not open this PDF: ${
              error?.message || "Unknown PDF error"
          }`,
      );
      setStatusType("error");
    } finally {
      setBusy(false);
      setStage("");
      setProgress(0);
    }
  };

  const rescanHeadings = async () => {
    if (!sourceBytes) {
      return;
    }

    setBusy(true);
    clearResult();

    try {
      const detectedHeadings = await scanHeadings(
          copyArrayBuffer(sourceBytes),
      );

      setStatus(
          `Detected ${detectedHeadings.length} headings. Review and edit the outline before export.`,
      );
      setStatusType("info");
    } catch (error) {
      console.error(error);
      setStatus(
          `Heading detection failed: ${
              error?.message || "Unknown error"
          }`,
      );
      setStatusType("error");
    } finally {
      setBusy(false);
      setStage("");
      setProgress(0);
    }
  };

  const drawWritingPattern = ({
                                page,
                                originalWidth,
                                originalHeight,
                                newWidth,
                                newHeight,
                                marginLeft,
                                marginRight,
                                marginTop,
                                marginBottom,
                                step,
                                patternPdfColor,
                                lineThickness,
                                dotRadius,
                              }) => {
    const originalLeft = marginLeft;
    const originalRight = marginLeft + originalWidth;
    const originalBottom = marginBottom;
    const originalTop = marginBottom + originalHeight;

    const lineOptions = {
      thickness: lineThickness,
      color: patternPdfColor,
      opacity: 1,
    };

    const drawVerticalLine = (x) => {
      if (x < originalLeft || x > originalRight) {
        page.drawLine({
          start: { x, y: 0 },
          end: { x, y: newHeight },
          ...lineOptions,
        });

        return;
      }

      if (marginBottom > 0) {
        page.drawLine({
          start: { x, y: 0 },
          end: { x, y: originalBottom },
          ...lineOptions,
        });
      }

      if (marginTop > 0) {
        page.drawLine({
          start: { x, y: originalTop },
          end: { x, y: newHeight },
          ...lineOptions,
        });
      }
    };

    const drawHorizontalLine = (y) => {
      if (y < originalBottom || y > originalTop) {
        page.drawLine({
          start: { x: 0, y },
          end: { x: newWidth, y },
          ...lineOptions,
        });

        return;
      }

      if (marginLeft > 0) {
        page.drawLine({
          start: { x: 0, y },
          end: { x: originalLeft, y },
          ...lineOptions,
        });
      }

      if (marginRight > 0) {
        page.drawLine({
          start: { x: originalRight, y },
          end: { x: newWidth, y },
          ...lineOptions,
        });
      }
    };

    if (paperStyle === "grid") {
      for (let x = 0; x <= newWidth; x += step) {
        drawVerticalLine(x);
      }

      for (let y = 0; y <= newHeight; y += step) {
        drawHorizontalLine(y);
      }
    }

    if (paperStyle === "lines") {
      for (let y = 0; y <= newHeight; y += step) {
        drawHorizontalLine(y);
      }
    }

    if (paperStyle === "dots") {
      for (let x = 0; x <= newWidth; x += step) {
        for (let y = 0; y <= newHeight; y += step) {
          const isOutsideOriginal =
              x < originalLeft ||
              x > originalRight ||
              y < originalBottom ||
              y > originalTop;

          if (isOutsideOriginal) {
            page.drawCircle({
              x,
              y,
              size: dotRadius,
              color: patternPdfColor,
              opacity: 1,
            });
          }
        }
      }
    }
  };

  const createGoodnotesPdf = async () => {
    if (!sourceBytes || !sourceFile) {
      return;
    }

    clearResult();

    setBusy(true);
    setStage("Building PDF");
    setProgress(1);
    setStatus("Adding margins and writing space…");
    setStatusType("info");

    try {
      /*
       * Load the source PDF, but create a separate output PDF.
       *
       * Embedding the original pages into new pages is more reliable than
       * resizing and translating Word-generated PDF pages in place.
       */
      const sourcePdf = await PDFDocument.load(
          copyArrayBuffer(sourceBytes),
          {
            ignoreEncryption: false,
            updateMetadata: false,
          },
      );

      const pdfDocument = await PDFDocument.create();

      const sourcePages = sourcePdf.getPages();

      const embeddedPages =
          await pdfDocument.embedPages(sourcePages);

      const millimetresToPoints = 72 / 25.4;

      const spacingInPoints =
          Math.max(2, Number(paperSpacing)) *
          millimetresToPoints;

      const backgroundPdfColor = hexToPdfRgb(backgroundColor);
      const patternPdfColor = hexToPdfRgb(patternColor);
      const borderPdfColor = hexToPdfRgb(borderColorHex);
      const white = rgb(1, 1, 1);

      for (
          let pageIndex = 0;
          pageIndex < sourcePages.length;
          pageIndex += 1
      ) {
        const sourcePage = sourcePages[pageIndex];
        const embeddedPage = embeddedPages[pageIndex];

        const sourceSize = sourcePage.getSize();

        const originalWidth = sourceSize.width;
        const originalHeight = sourceSize.height;

        const marginLeft =
            originalWidth * (leftMargin / 100);

        const marginRight =
            originalWidth * (rightMargin / 100);

        const marginTop =
            originalHeight * (topMargin / 100);

        const marginBottom =
            originalHeight * (bottomMargin / 100);

        const newWidth =
            originalWidth + marginLeft + marginRight;

        const newHeight =
            originalHeight + marginTop + marginBottom;

        /*
         * Create a completely new page with the final dimensions.
         */
        const page = pdfDocument.addPage([
          newWidth,
          newHeight,
        ]);

        /*
         * Paint the complete background with the selected paper color.
         */
        page.drawRectangle({
          x: 0,
          y: 0,
          width: newWidth,
          height: newHeight,
          color: backgroundPdfColor,
        });

        /*
         * Draw the grid, lines or dots before placing the source page.
         * The source page will cover the pattern in the original-page area.
         */
        if (paperStyle !== "blank") {
          drawWritingPattern({
            page,
            originalWidth,
            originalHeight,
            newWidth,
            newHeight,
            marginLeft,
            marginRight,
            marginTop,
            marginBottom,
            step: spacingInPoints,
            patternPdfColor,
            lineThickness: activeThickness.lineWidthPt,
            dotRadius: activeThickness.dotRadiusPt,
          });
        }

        /*
         * Keep a white backing behind the original page so transparent PDFs
         * remain legible when a darker writing-paper background is chosen.
         */
        page.drawRectangle({
          x: marginLeft,
          y: marginBottom,
          width: originalWidth,
          height: originalHeight,
          color: white,
        });

        /*
         * Place the complete original PDF page inside the new page.
         * No scaling is performed.
         */
        page.drawPage(embeddedPage, {
          x: marginLeft,
          y: marginBottom,
          width: originalWidth,
          height: originalHeight,
        });

        /*
         * Draw the borders after the original page so they remain visible.
         */
        if (showBorder) {
          const outerInset = 4;

          page.drawRectangle({
            x: outerInset,
            y: outerInset,
            width: Math.max(
                1,
                newWidth - outerInset * 2,
            ),
            height: Math.max(
                1,
                newHeight - outerInset * 2,
            ),
            borderWidth: 0.9,
            borderColor: borderPdfColor,
          });

          page.drawRectangle({
            x: marginLeft,
            y: marginBottom,
            width: originalWidth,
            height: originalHeight,
            borderWidth: 0.65,
            borderColor: borderPdfColor,
          });
        }

        setProgress(
            Math.round(
                4 +
                ((pageIndex + 1) /
                    sourcePages.length) *
                84,
            ),
        );

        /*
         * Yield occasionally so the browser interface remains responsive.
         */
        if (pageIndex % 8 === 0) {
          await sleep();
        }
      }

      /*
       * Add the reviewed chapter outline to the newly generated pages.
       */
      if (headings.some((heading) => heading.enabled)) {
        setStatus(
            outlineMode === "keep"
                ? "Copying the original PDF outline…"
                : "Embedding the detected chapter outline…",
        );

        installOutlines(pdfDocument, headings);
      }

      pdfDocument.setTitle(
          `${sourceFile.name.replace(
              /\.pdf$/i,
              "",
          )} - Goodnotes`,
      );

      pdfDocument.setSubject(
          "PDF prepared with note margins, writing paper and chapter outline",
      );

      pdfDocument.setCreator("Goodnotes PDF Prep");

      pdfDocument.setProducer(
          "Goodnotes PDF Prep using pdf-lib",
      );

      setStage("Saving PDF");
      setStatus("Optimizing and saving the finished PDF…");
      setProgress(92);

      const outputBytes = await pdfDocument.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 20,
      });

      const outputBlob = new Blob([outputBytes], {
        type: "application/pdf",
      });

      const outputUrl =
          URL.createObjectURL(outputBlob);

      const baseName = sourceFile.name.replace(
          /\.pdf$/i,
          "",
      );

      setResultName(`${baseName}_Goodnotes.pdf`);
      setResultUrl(outputUrl);
      setProgress(100);

      setStatus(
          "Finished. The PDF was processed locally and is ready to download.",
      );

      setStatusType("success");
    } catch (error) {
      console.error(error);

      setStatus(
          `Processing failed: ${
              error?.message ||
              "Unknown PDF processing error"
          }`,
      );

      setStatusType("error");
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  const changeOutlineMode = async (nextMode) => {
    if (nextMode === outlineMode) {
      return;
    }

    setOutlineMode(nextMode);
    clearResult();

    if (!sourceBytes) {
      return;
    }

    setBusy(true);
    setProgress(0);

    try {
      if (nextMode === "detect") {
        const detectedHeadings = await scanHeadings(
            copyArrayBuffer(sourceBytes),
        );

        setStatus(
            `Detected ${detectedHeadings.length} numbered headings.`,
        );
      } else {
        setStage("Reading existing outline");
        setStatus("Reading bookmarks from the source PDF…");

        const existingOutline = await extractExistingOutline(
            copyArrayBuffer(sourceBytes),
        );

        setHeadings(existingOutline);

        setStatus(
            existingOutline.length > 0
                ? `Found ${existingOutline.length} existing outline entries.`
                : "This PDF does not contain an existing outline.",
        );

        setStatusType("info");
      }
    } catch (error) {
      console.error(error);

      setStatus(
          `Could not read the outline: ${
              error?.message || "Unknown error"
          }`,
      );

      setStatusType("error");
    } finally {
      setBusy(false);
      setStage("");
      setProgress(0);
    }
  };

  const activeCount = headings.filter((heading) => heading.enabled).length;

  const scaleLabel = `${(1 + (leftMargin + rightMargin) / 100).toFixed(2)} × ${(
      1 +
      (topMargin + bottomMargin) / 100
  ).toFixed(2)}`;

  const widestMargin = [
    ["top", topMargin],
    ["right", rightMargin],
    ["bottom", bottomMargin],
    ["left", leftMargin],
  ].reduce((widest, entry) => (entry[1] > widest[1] ? entry : widest));

  const previewHeading = headings.find((heading) => heading.enabled);

  const steps = [
    { id: "source", label: "source", done: Boolean(sourceFile) },
    { id: "layout", label: "layout", done: Boolean(sourceFile) },
    { id: "preview", label: "preview", done: Boolean(sourceFile) },
    {
      id: "outline",
      label: "outline",
      done: Boolean(sourceFile) && headings.length > 0,
    },
    { id: "export", label: "export", done: Boolean(resultUrl) },
  ];

  const currentStep = steps.find((step) => !step.done)?.id ?? "export";

  const progressWidth = busy
      ? clamp(progress, 0, 100)
      : resultUrl
          ? 100
          : 0;

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    openPdf(event.dataTransfer.files?.[0]);
  };

  return (
      <div className="app-shell">
        <aside className="app-sidebar" aria-label="About this tool">
          <div className="app-sidebar__top">
            <h1 className="app-title">
              Goodnotes
              <br />
              PDF Prep.
            </h1>

            <p className="app-lede">
              Writing margins, grid paper and a chapter outline for any PDF.
            </p>

            <ol className="app-steps" aria-label="Progress">
              {steps.map((step, index) => (
                  <li
                      key={step.id}
                      className={[
                        step.done ? "is-done" : "",
                        currentStep === step.id ? "is-current" : "",
                      ]
                          .filter(Boolean)
                          .join(" ")}
                      aria-current={currentStep === step.id ? "step" : undefined}
                  >
                    <a href={`#tile-${step.id}`}>
                      <span className="app-steps__marker" aria-hidden="true">
                        {currentStep === step.id ? "→" : step.done ? "✓" : ""}
                      </span>
                      {String(index + 1).padStart(2, "0")} {step.label}
                    </a>
                  </li>
              ))}
            </ol>
          </div>

          <div className="app-sidebar__bottom">
            <a
                className="text-link"
                href="https://xandervanhaeren.github.io/"
            >
              ← Xander Vanhaeren
            </a>

            <a
                className="text-link"
                href="https://github.com/XanderVanhaeren/goodnotes-pdf-prep"
                target="_blank"
                rel="noopener noreferrer"
            >
              Source on GitHub
            </a>

            <p className="app-privacy">
              Runs in your browser.
              <br />
              Files never leave this device.
            </p>
          </div>
        </aside>

        <main className="app-grid">
          {/* 01 / source ------------------------------------------------ */}
          <section
              id="tile-source"
              className="tile tile--source"
              aria-labelledby="tile-source-title"
          >
            <TileHead id="tile-source-title" label="01 / source">
              {sourceFile ? "loaded" : "drop or browse"}
            </TileHead>

            {!sourceFile ? (
                <button
                    type="button"
                    className={`drop-zone ${dragging ? "is-dragging" : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setDragging(false);
                    }}
                    onDrop={handleDrop}
                >
                  <Upload size={18} strokeWidth={1.75} />
                  <span>
                    <strong>Drop a PDF here</strong>
                    <small>or click to browse</small>
                  </span>
                </button>
            ) : (
                <div className="file-box">
                  <div className="file-box__icon" aria-hidden="true">
                    PDF
                  </div>

                  <div className="file-box__main">
                    <p className="file-box__name" title={sourceFile.name}>
                      {sourceFile.name}
                    </p>

                    <p className="file-box__meta">
                      {formatFileSize(sourceFile.size)}
                      {pageCount ? ` · ${pageCount} pages` : ""}
                    </p>
                  </div>

                  <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove PDF"
                      title="Remove PDF"
                      disabled={busy}
                      onClick={resetFile}
                  >
                    <X size={15} />
                  </button>
                </div>
            )}

            <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(event) => openPdf(event.target.files?.[0])}
            />
          </section>

          {/* 02 / layout ------------------------------------------------ */}
          <section
              id="tile-layout"
              className="tile tile--layout"
              aria-labelledby="tile-layout-title"
          >
            <TileHead id="tile-layout-title" label="02 / layout">
              % of page
            </TileHead>

            <div className="margin-grid">
              <MarginField
                  label="top"
                  value={topMargin}
                  onChange={setTopMargin}
              />
              <MarginField
                  label="right"
                  value={rightMargin}
                  onChange={setRightMargin}
              />
              <MarginField
                  label="bottom"
                  value={bottomMargin}
                  onChange={setBottomMargin}
              />
              <MarginField
                  label="left"
                  value={leftMargin}
                  onChange={setLeftMargin}
              />
            </div>

            <Segmented
                label="paper"
                value={paperStyle}
                onChange={setPaperStyle}
                options={[
                  { value: "grid", label: "grid" },
                  { value: "lines", label: "lines" },
                  { value: "dots", label: "dots" },
                  { value: "blank", label: "blank" },
                ]}
            />

            <Segmented
                label="spacing"
                value={paperSpacing}
                onChange={setPaperSpacing}
                disabled={paperStyle === "blank"}
                options={[
                  { value: "2.5", label: "2.5mm" },
                  { value: "5", label: "5mm" },
                  { value: "10", label: "10mm" },
                ]}
            />

            <Segmented
                label="weight"
                value={patternThickness}
                onChange={handleThicknessChange}
                disabled={paperStyle === "blank"}
                options={THICKNESS_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
            />

            <ColorSelector
                label="page bg"
                presets={BACKGROUND_PRESETS}
                value={backgroundColor}
                onChange={handleBackgroundColorChange}
                customLabel="Custom background color"
            />

            <ColorSelector
                label={paperStyle === "blank" ? "pattern" : paperStyle}
                hint={darkBackground ? "dark bg" : "light bg"}
                presets={activePatternPresets}
                value={patternColor}
                onChange={handlePatternColorChange}
                disabled={paperStyle === "blank"}
                customLabel={`Custom ${paperStyle === "blank" ? "pattern" : paperStyle} color`}
            />

            <Toggle
                enabled={showBorder}
                onChange={setShowBorder}
                label="page border"
                description="frame around the page and the original"
            />
          </section>

          {/* 03 / preview ----------------------------------------------- */}
          <section
              id="tile-preview"
              className="tile tile--preview"
              aria-labelledby="tile-preview-title"
          >
            <TileHead id="tile-preview-title" label="03 / preview">
              page → {scaleLabel}
            </TileHead>

            <div className="preview-stage">
              <div
                  className={`preview-page ${darkBackground ? "is-dark" : ""}`}
                  style={{
                    "--page-ratio": pageAspect.width / pageAspect.height,
                    ...previewPattern,
                  }}
              >
                <div
                    className="original-page"
                    style={originalPagePosition}
                >
                  <div className="original-page__inner">
                    <p className="original-page__title">
                      {previewHeading
                          ? `${previewHeading.code ? `${previewHeading.code} ` : ""}${previewHeading.title}`
                          : "Original PDF page"}
                    </p>
                    <i style={{ width: "92%" }} />
                    <i style={{ width: "84%" }} />
                    <i style={{ width: "88%" }} />
                    <i style={{ width: "58%" }} />
                    <span className="original-page__figure" />
                    <i style={{ width: "78%" }} />
                    <i style={{ width: "66%" }} />
                  </div>
                </div>

                {showBorder && (
                    <div
                        className="preview-outer-border"
                        style={{ borderColor: borderColorHex }}
                    />
                )}
              </div>
            </div>

            <div className="tile-foot">
              <span>original stays vector</span>
              <span>
                writing space: {widestMargin[0]} {widestMargin[1]}%
              </span>
            </div>
          </section>

          {/* 04 / outline ----------------------------------------------- */}
          <section
              id="tile-outline"
              className="tile tile--outline"
              aria-labelledby="tile-outline-title"
          >
            <TileHead id="tile-outline-title" label="04 / outline">
              {headings.length > 0 ? (
                  <>
                    <b>{activeCount}</b> / {headings.length} enabled
                  </>
              ) : (
                  "bookmarks"
              )}
            </TileHead>

            <div className="outline-controls">
              <Segmented
                  label="mode"
                  value={outlineMode}
                  onChange={changeOutlineMode}
                  disabled={busy}
                  options={[
                    { value: "detect", label: "detect" },
                    { value: "keep", label: "keep existing" },
                  ]}
              />

              {sourceBytes && outlineMode === "detect" && (
                  <button
                      type="button"
                      className="button button--ghost button--small"
                      disabled={busy}
                      onClick={rescanHeadings}
                  >
                    <RotateCcw size={13} />
                    rescan
                  </button>
              )}
            </div>

            {sourceFile && headings.length > 0 ? (
                <OutlineEditor
                    headings={headings}
                    setHeadings={setHeadings}
                />
            ) : (
                <p className="empty-state">
                  {sourceFile
                      ? outlineMode === "detect"
                          ? "No numbered headings found. Try rescanning, or keep the PDF’s existing outline."
                          : "This PDF has no existing outline. Switch to detect headings."
                      : "Open a PDF to detect titles like 1.1, 2.3, 4.4.2 and Hoofdstuk 6."}
                </p>
            )}
          </section>

          {/* 05 / export ------------------------------------------------ */}
          <section
              id="tile-export"
              className="tile tile--export"
              aria-labelledby="tile-export-title"
          >
            <TileHead id="tile-export-title" label="05 / export">
              {busy ? `${progress}%` : resultUrl ? "100%" : "idle"}
            </TileHead>

            <div className="export-status">
              <div
                  className="progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressWidth}
              >
                <div
                    className="progress-fill"
                    style={{ width: `${progressWidth}%` }}
                />
              </div>

              <p
                  className={`status-line status-line--${busy ? "info" : statusType}`}
                  aria-live="polite"
              >
                {busy ? (
                    <>
                      <b>{(stage || "working").toLowerCase()}</b>
                      {status ? ` — ${status}` : ""}
                    </>
                ) : status ? (
                    <>
                      {statusType === "success" ? (
                          <Check size={13} strokeWidth={2.5} />
                      ) : statusType === "error" ? (
                          <AlertTriangle size={13} />
                      ) : null}
                      <span>{status}</span>
                    </>
                ) : (
                    <span>Waiting for a PDF.</span>
                )}
              </p>
            </div>

            <div className="export-actions">
              <button
                  type="button"
                  className="button button--primary"
                  disabled={!sourceBytes || !pageCount || busy}
                  onClick={createGoodnotesPdf}
              >
                {busy ? (
                    <>
                      <LoaderCircle size={15} className="spinning-icon" />
                      Working…
                    </>
                ) : (
                    "Create Goodnotes PDF"
                )}
              </button>

              {resultUrl && (
                  <a
                      className="button button--ghost"
                      href={resultUrl}
                      download={resultName}
                  >
                    Download
                    <Download size={15} />
                  </a>
              )}
            </div>

            <p className="footnote">
              Large PDFs (400+ pages) can take a few minutes and a lot of
              memory. Keep this tab open until the download appears.
            </p>
          </section>
        </main>
      </div>
  );
}
