import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileText,
  Grid3X3,
  ListTree,
  LoaderCircle,
  Lock,
  RotateCcw,
  Settings2,
  Trash2,
  Upload,
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

async function detectHeadings(pdfBytes, onProgress) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(copyArrayBuffer(pdfBytes)),
    disableFontFace: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

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

function NumberSetting({
                         label,
                         value,
                         onChange,
                         suffix = "%",
                         minimum = 0,
                         maximum = 100,
                       }) {
  return (
      <div className="field">
        <label>{label}</label>

        <div className="number-wrap">
          <input
              type="number"
              min={minimum}
              max={maximum}
              value={value}
              onChange={(event) =>
                  onChange(clamp(event.target.value, minimum, maximum))
              }
          />

          <span className="suffix">{suffix}</span>
        </div>
      </div>
  );
}

function Toggle({ enabled, onChange, label, description }) {
  return (
      <div className="toggle-row">
        <div>
          <strong>{label}</strong>
          <small>{description}</small>
        </div>

        <button
            type="button"
            className={`switch ${enabled ? "enabled" : ""}`}
            role="switch"
            aria-checked={enabled}
            onClick={() => onChange(!enabled)}
        >
          <span className="switch-knob" />
        </button>
      </div>
  );
}

function OutlineEditor({ headings, setHeadings }) {
  const [expanded, setExpanded] = useState(true);

  const activeCount = headings.filter(
      (heading) => heading.enabled,
  ).length;

  const updateHeading = (headingId, changes) => {
    setHeadings((currentHeadings) =>
        currentHeadings.map((heading) =>
            heading.id === headingId
                ? { ...heading, ...changes }
                : heading,
        ),
    );
  };

  const enableAll = () => {
    setHeadings((currentHeadings) =>
        currentHeadings.map((heading) => ({
          ...heading,
          enabled: true,
        })),
    );
  };

  const disableAll = () => {
    setHeadings((currentHeadings) =>
        currentHeadings.map((heading) => ({
          ...heading,
          enabled: false,
        })),
    );
  };

  return (
      <section className="card">
        <div className="card-header">
          <button
              type="button"
              className="outline-card-button"
              onClick={() => setExpanded((current) => !current)}
          >
            <h2 className="card-title">
              <ListTree size={18} />
              Detected outline
            </h2>

            {expanded ? (
                <ChevronDown size={18} />
            ) : (
                <ChevronRight size={18} />
            )}
          </button>
        </div>

        {expanded && (
            <div className="card-body">
              <div className="outline-toolbar">
            <span>
              {activeCount} of {headings.length} bookmarks enabled
            </span>

                <span>
              <button
                  type="button"
                  className="text-button"
                  onClick={enableAll}
              >
                Enable all
              </button>

                  {" · "}

                  <button
                      type="button"
                      className="text-button"
                      onClick={disableAll}
                  >
                Disable all
              </button>
            </span>
              </div>

              {headings.length === 0 ? (
                  <div className="outline-empty">
                    No numbered headings were found. Use “Scan headings again”
                    after opening a PDF, or keep the PDF’s existing outline.
                  </div>
              ) : (
                  <div className="outline-list">
                    {headings.map((heading) => (
                        <div
                            key={heading.id}
                            className={[
                              "outline-row",
                              `level-${heading.level}`,
                              heading.enabled ? "" : "disabled",
                            ]
                                .filter(Boolean)
                                .join(" ")}
                        >
                          <button
                              type="button"
                              className="icon-button"
                              title={
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
                            {heading.enabled ? (
                                <Eye size={16} color="var(--accent-soft)" />
                            ) : (
                                <EyeOff size={16} />
                            )}
                          </button>

                          <input
                              className="outline-small-input"
                              aria-label="Bookmark section number"
                              value={heading.code}
                              onChange={(event) =>
                                  updateHeading(heading.id, {
                                    code: event.target.value,
                                  })
                              }
                          />

                          <input
                              className="outline-title-input"
                              aria-label="Bookmark title"
                              value={heading.title}
                              onChange={(event) =>
                                  updateHeading(heading.id, {
                                    title: event.target.value,
                                  })
                              }
                          />

                          <input
                              className="outline-small-input"
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

                          <select
                              className="outline-small-input outline-level-cell"
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
                        </div>
                    ))}
                  </div>
              )}
            </div>
        )}
      </section>
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
    if (paperStyle === "blank") {
      return {};
    }

    if (paperStyle === "lines") {
      return {
        backgroundImage:
            "linear-gradient(var(--pdf-grid-line) 1px, transparent 1px)",
        backgroundSize: "14px 14px",
      };
    }

    if (paperStyle === "dots") {
      return {
        backgroundImage:
            "radial-gradient(var(--pdf-dot-color) 1px, transparent 1px)",
        backgroundSize: "14px 14px",
      };
    }

    return {
      backgroundImage:
          "linear-gradient(var(--pdf-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--pdf-grid-line) 1px, transparent 1px)",
      backgroundSize: "14px 14px",
    };
  }, [paperStyle]);

  const originalPagePosition = useMemo(() => {
    const totalHorizontal = 100 + leftMargin + rightMargin;
    const totalVertical = 100 + topMargin + bottomMargin;

    return {
      left: `${(leftMargin / totalHorizontal) * 100}%`,
      right: `${(rightMargin / totalHorizontal) * 100}%`,
      top: `${(topMargin / totalVertical) * 100}%`,
      bottom: `${(bottomMargin / totalVertical) * 100}%`,
      border: showBorder
          ? "1px solid var(--pdf-border-color)"
          : "none",
    };
  }, [
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
                                patternColor,
                              }) => {
    const originalLeft = marginLeft;
    const originalRight = marginLeft + originalWidth;
    const originalBottom = marginBottom;
    const originalTop = marginBottom + originalHeight;

    const lineOptions = {
      thickness: 0.25,
      color: patternColor,
      opacity: 0.72,
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
              size: 0.65,
              color: patternColor,
              opacity: 0.82,
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

      const patternColor = rgb(0.76, 0.82, 0.88);
      const borderColor = rgb(0.3, 0.36, 0.43);
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
         * Paint the complete background white.
         */
        page.drawRectangle({
          x: 0,
          y: 0,
          width: newWidth,
          height: newHeight,
          color: white,
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
            patternColor,
          });
        }

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
            borderColor,
          });

          page.drawRectangle({
            x: marginLeft,
            y: marginBottom,
            width: originalWidth,
            height: originalHeight,
            borderWidth: 0.65,
            borderColor,
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

  const statusClass =
      statusType === "success"
          ? "status-success"
          : statusType === "error"
              ? "status-error"
              : "status-info";

  return (
      <>
            <div className="app-shell">
        <header className="app-header">
          <div className="header-inner">
            <div className="brand">
              <div className="brand-icon">
                <FileText size={23} />
              </div>

              <div>
                <h1>Goodnotes PDF Prep</h1>
                <p>
                  Add margins, writing paper, borders and chapter
                  outlines
                </p>
              </div>
            </div>

            <div className="local-badge">
              <Lock size={14} />
              <span>Files stay on this device</span>
            </div>
          </div>
        </header>

        <main className="app-main">
          <div className="column left-column">
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Upload size={18} />
                  Source PDF
                </h2>
              </div>

              <div className="card-body">
                {!sourceFile ? (
                    <button
                        type="button"
                        className={`drop-zone ${
                            dragging ? "dragging" : ""
                        }`}
                        onClick={() =>
                            fileInputRef.current?.click()
                        }
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
                        onDrop={(event) => {
                          event.preventDefault();
                          setDragging(false);

                          const droppedFile =
                              event.dataTransfer.files?.[0];

                          openPdf(droppedFile);
                        }}
                    >
                      <div>
                        <div className="drop-icon">
                          <Upload size={25} />
                        </div>

                        <strong>Drop a PDF here</strong>
                        <span>or click to browse</span>
                      </div>
                    </button>
                ) : (
                    <div className="file-box">
                      <FileText
                          size={21}
                          color="var(--accent-soft)"
                      />

                      <div className="file-main">
                        <p className="file-name">
                          {sourceFile.name}
                        </p>

                        <p className="file-meta">
                          {formatFileSize(sourceFile.size)}
                          {pageCount
                              ? ` · ${pageCount} pages`
                              : ""}
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
                        <Trash2 size={17} />
                      </button>
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    onChange={(event) => {
                      const selectedFile =
                          event.target.files?.[0];

                      openPdf(selectedFile);
                    }}
                />
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Settings2 size={18} />
                  Layout
                </h2>
              </div>

              <div className="card-body">
                <div className="settings-grid">
                  <NumberSetting
                      label="Right margin"
                      value={rightMargin}
                      onChange={setRightMargin}
                  />

                  <NumberSetting
                      label="Left margin"
                      value={leftMargin}
                      onChange={setLeftMargin}
                  />

                  <NumberSetting
                      label="Top margin"
                      value={topMargin}
                      onChange={setTopMargin}
                  />

                  <NumberSetting
                      label="Bottom margin"
                      value={bottomMargin}
                      onChange={setBottomMargin}
                  />
                </div>

                <div className="settings-section">
                  <div className="settings-grid">
                    <div className="field">
                      <label>Paper style</label>

                      <select
                          value={paperStyle}
                          onChange={(event) =>
                              setPaperStyle(event.target.value)
                          }
                      >
                        <option value="grid">Grid</option>
                        <option value="lines">
                          Ruled lines
                        </option>
                        <option value="dots">Dots</option>
                        <option value="blank">Blank</option>
                      </select>
                    </div>

                    <div className="field">
                      <label>Spacing</label>

                      <select
                          value={paperSpacing}
                          disabled={paperStyle === "blank"}
                          onChange={(event) =>
                              setPaperSpacing(
                                  event.target.value,
                              )
                          }
                      >
                        <option value="2.5">2.5 mm</option>
                        <option value="5">5 mm</option>
                        <option value="10">10 mm</option>
                      </select>
                    </div>
                  </div>

                  <Toggle
                      enabled={showBorder}
                      onChange={setShowBorder}
                      label="Full page border"
                      description="Includes a divider around the original page"
                  />

                  <div className="field">
                    <label>Outline handling</label>

                    <select
                        value={outlineMode}
                        disabled={busy}
                        onChange={async (event) => {
                          const nextMode = event.target.value;

                          setOutlineMode(nextMode);
                          clearResult();

                          if (!sourceBytes) {
                            return;
                          }

                          setBusy(true);
                          setProgress(0);

                          try {
                            if (nextMode === "detect") {
                              const detectedHeadings =
                                  await scanHeadings(
                                      copyArrayBuffer(sourceBytes),
                                  );

                              setStatus(
                                  `Detected ${detectedHeadings.length} numbered headings.`,
                              );
                            } else {
                              setStage("Reading existing outline");
                              setStatus(
                                  "Reading bookmarks from the source PDF…",
                              );

                              const existingOutline =
                                  await extractExistingOutline(
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
                        }}
                    >
                      <option value="detect">
                        Detect and replace outline
                      </option>

                      <option value="keep">
                        Keep existing outline
                      </option>
                    </select>
                  </div>

                  {sourceBytes &&
                      outlineMode === "detect" && (
                          <button
                              type="button"
                              className="button button-secondary button-full"
                              disabled={busy}
                              onClick={rescanHeadings}
                          >
                            <RotateCcw size={15} />
                            Scan headings again
                          </button>
                      )}
                </div>
              </div>
            </section>
          </div>

          <div className="column right-column">
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Grid3X3 size={18} />
                  Layout preview
                </h2>
              </div>

              <div className="preview-area">
                <div
                    className="preview-page"
                    style={{
                      aspectRatio: `${pageAspect.width} / ${pageAspect.height}`,
                      ...previewPattern,
                    }}
                >
                  <div
                      className="original-page"
                      style={originalPagePosition}
                  >
                    <div className="original-page-inner">
                      <BookOpen
                          size={43}
                          color="var(--pdf-page-book-icon)"
                      />

                      <strong>Original PDF page</strong>

                      <span>
                        Original text and graphics remain
                        vector-based
                      </span>
                    </div>
                  </div>

                  {showBorder && (
                      <div className="preview-outer-border" />
                  )}
                </div>
              </div>
            </section>

            {sourceFile && headings.length > 0 && (
                <OutlineEditor
                    headings={headings}
                    setHeadings={setHeadings}
                />
            )}

            <section className="card">
              <div className="status-card">
                {busy && (
                    <>
                      <div className="progress-header">
                        <span>{stage || "Working"}</span>
                        <span>{progress}%</span>
                      </div>

                      <div className="progress-track">
                        <div
                            className="progress-fill"
                            style={{
                              width: `${clamp(
                                  progress,
                                  0,
                                  100,
                              )}%`,
                            }}
                        />
                      </div>

                      <p className="progress-message">
                        {status}
                      </p>
                    </>
                )}

                {!busy && status && (
                    <div
                        className={`status-box ${statusClass}`}
                    >
                      {statusType === "success" ? (
                          <Check
                              size={18}
                              style={{ flex: "0 0 auto" }}
                          />
                      ) : statusType === "error" ? (
                          <AlertTriangle
                              size={18}
                              style={{ flex: "0 0 auto" }}
                          />
                      ) : (
                          <FileText
                              size={18}
                              style={{ flex: "0 0 auto" }}
                          />
                      )}

                      <span>{status}</span>
                    </div>
                )}

                <div
                    className={`actions ${
                        resultUrl ? "" : "one"
                    }`}
                >
                  <button
                      type="button"
                      className="button button-primary"
                      disabled={
                          !sourceBytes ||
                          !pageCount ||
                          busy
                      }
                      onClick={createGoodnotesPdf}
                  >
                    {busy ? (
                        <>
                          <LoaderCircle
                              size={17}
                              className="spinning-icon"
                          />
                          Working…
                        </>
                    ) : (
                        <>
                          <FileText size={17} />
                          Create Goodnotes PDF
                        </>
                    )}
                  </button>

                  {resultUrl && (
                      <a
                          className="button button-secondary"
                          href={resultUrl}
                          download={resultName}
                      >
                        <Download size={17} />
                        Download PDF
                      </a>
                  )}
              </div>

              <p className="footnote">
                A 400–500 page PDF can require several minutes
                and substantial memory. Keep this browser tab open
                until the download button appears.
              </p>
          </div>
        </section>
      </div>
      </main>
</div>
</>
);
}