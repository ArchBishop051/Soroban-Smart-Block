/**
 * Deterministic Tagged PDF 1.7 Engine
 * Generates byte-stable, accessible compliance and audit reports for Soroban.
 * Zero external native binary dependencies.
 */

function escapePdfText(str) {
  if (typeof str !== "string") str = String(str ?? "");
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export class DeterministicPdfWriter {
  constructor({
    title = "Audit Report",
    subtitle = "Soroban Smart Block Explorer",
    timestamp = "2026-01-01T00:00:00Z",
    verificationHash = "",
    signature = "",
    permalink = "",
    watermark = null,
  } = {}) {
    this.title = title;
    this.subtitle = subtitle;
    this.timestamp = timestamp;
    this.verificationHash = verificationHash;
    this.signature = signature;
    this.permalink = permalink;
    this.watermark = watermark;

    // A4 dimensions (points)
    this.pageWidth = 595.28;
    this.pageHeight = 841.89;
    this.margin = 40;
    this.usableWidth = this.pageWidth - this.margin * 2; // 515.28

    this.pages = [];
    this.currentPage = null;
    this.currentY = 0;

    // Start with first page
    this.addPage();
  }

  addPage() {
    if (this.currentPage) {
      this.pages.push(this.currentPage);
    }
    this.currentPage = {
      commands: [],
    };
    // Initial Y position below header
    this.currentY = this.pageHeight - this.margin - 45;

    // Draw header on new page
    this.drawPageHeader();

    // If watermark set, draw watermark
    if (this.watermark) {
      this.drawWatermark(this.watermark);
    }
  }

  ensureSpace(neededPoints) {
    // Leave room for footer (55 pt from bottom)
    if (this.currentY - neededPoints < this.margin + 45) {
      this.addPage();
    }
  }

  drawPageHeader() {
    const pageNum = this.pages.length + 1;
    const isFirstPage = pageNum === 1;

    // Top logo / banner line
    this.currentPage.commands.push(
      "q",
      "0.05 0.08 0.12 rg", // Dark brand color
      `BT /F2 10 Tf ${this.margin} ${this.pageHeight - this.margin + 12} Td (${escapePdfText(this.subtitle.toUpperCase())}) ET`,
      "0.4 0.45 0.5 rg",
      `BT /F1 8 Tf ${this.pageWidth - this.margin - 120} ${this.pageHeight - this.margin + 12} Td (CONFIDENTIAL AUDIT) ET`,
      "0.7 0.75 0.8 RG",
      "0.5 w",
      `${this.margin} ${this.pageHeight - this.margin + 6} m ${this.pageWidth - this.margin} ${this.pageHeight - this.margin + 6} l S`,
      "Q"
    );

    if (isFirstPage) {
      this.currentPage.commands.push(
        "q",
        "0.05 0.08 0.12 rg",
        `BT /F2 16 Tf ${this.margin} ${this.currentY} Td (${escapePdfText(this.title)}) ET`,
        "Q"
      );
      this.currentY -= 20;
    }
  }

  drawWatermark(text) {
    // Draw diagonal faint red watermark
    this.currentPage.commands.push(
      "q",
      "0.9 0.2 0.2 RG",
      "0.9 0.2 0.2 rg",
      "0.5 w",
      // Rotate 30 degrees around center
      "0.866 0.5 -0.5 0.866 200 400 cm",
      `BT /F2 36 Tf -120 0 Td (${escapePdfText(text.toUpperCase())}) ET`,
      "Q"
    );
  }

  drawSectionTitle(title) {
    this.ensureSpace(35);
    this.currentY -= 10;
    this.currentPage.commands.push(
      "q",
      "0.1 0.3 0.6 rg", // Accent blue
      `BT /F2 11 Tf ${this.margin} ${this.currentY} Td (${escapePdfText(title)}) ET`,
      "0.85 0.88 0.92 RG",
      "1 w",
      `${this.margin} ${this.currentY - 4} m ${this.pageWidth - this.margin} ${this.currentY - 4} l S`,
      "Q"
    );
    this.currentY -= 18;
  }

  drawBanner({ text, type = "warning" }) {
    this.ensureSpace(32);
    const boxHeight = 24;
    const y = this.currentY - boxHeight;

    const fill = type === "warning" ? "0.98 0.95 0.85 rg" : "0.98 0.88 0.88 rg";
    const border = type === "warning" ? "0.85 0.65 0.1 RG" : "0.85 0.2 0.2 RG";
    const textCol = type === "warning" ? "0.5 0.35 0.0 rg" : "0.7 0.1 0.1 rg";

    this.currentPage.commands.push(
      "q",
      fill,
      `${this.margin} ${y} ${this.usableWidth} ${boxHeight} re f`,
      border,
      "1 w",
      `${this.margin} ${y} ${this.usableWidth} ${boxHeight} re s`,
      textCol,
      `BT /F2 9 Tf ${this.margin + 8} ${y + 8} Td (${escapePdfText(text)}) ET`,
      "Q"
    );

    this.currentY -= boxHeight + 10;
  }

  drawKeyValue(key, value, { mono = false, highlight = false } = {}) {
    this.ensureSpace(16);
    const valStr = value === null || value === undefined || value === "" ? "—" : String(value);
    const font = mono ? "/F3" : "/F1";
    const fontSize = mono ? 8.5 : 9;

    this.currentPage.commands.push(
      "q",
      "0.35 0.4 0.45 rg", // Key label gray
      `BT /F2 9 Tf ${this.margin} ${this.currentY} Td (${escapePdfText(key)}:) ET`,
      highlight ? "0.05 0.1 0.4 rg" : "0.1 0.12 0.15 rg",
      `BT ${font} ${fontSize} Tf ${this.margin + 125} ${this.currentY} Td (${escapePdfText(valStr)}) ET`,
      "Q"
    );

    this.currentY -= 14;
  }

  drawTable(headers, rows, colWidths) {
    const rowHeight = 16;
    const headerHeight = 18;

    // Header space
    this.ensureSpace(headerHeight + rowHeight);

    // Draw header row
    this.currentPage.commands.push(
      "q",
      "0.92 0.94 0.96 rg", // Header bg
      `${this.margin} ${this.currentY - headerHeight} ${this.usableWidth} ${headerHeight} re f`,
      "0.8 0.83 0.88 RG",
      "0.5 w",
      `${this.margin} ${this.currentY - headerHeight} ${this.usableWidth} ${headerHeight} re s`,
      "0.15 0.2 0.25 rg"
    );

    let xOffset = this.margin;
    for (let i = 0; i < headers.length; i++) {
      const width = colWidths[i] || 100;
      this.currentPage.commands.push(
        `BT /F2 8.5 Tf ${xOffset + 4} ${this.currentY - 12} Td (${escapePdfText(headers[i])}) ET`
      );
      xOffset += width;
    }
    this.currentPage.commands.push("Q");
    this.currentY -= headerHeight;

    // Draw rows
    for (let r = 0; r < rows.length; r++) {
      this.ensureSpace(rowHeight);
      const row = rows[r];
      const bg = r % 2 === 0 ? "1 1 1 rg" : "0.98 0.98 0.99 rg";

      this.currentPage.commands.push(
        "q",
        bg,
        `${this.margin} ${this.currentY - rowHeight} ${this.usableWidth} ${rowHeight} re f`,
        "0.9 0.92 0.95 RG",
        "0.25 w",
        `${this.margin} ${this.currentY - rowHeight} m ${this.pageWidth - this.margin} ${this.currentY - rowHeight} l S`,
        "0.1 0.12 0.15 rg"
      );

      let colX = this.margin;
      for (let c = 0; c < row.length; c++) {
        const val = row[c] === null || row[c] === undefined ? "—" : String(row[c]);
        const width = colWidths[c] || 100;
        this.currentPage.commands.push(
          `BT /F1 8 Tf ${colX + 4} ${this.currentY - 11} Td (${escapePdfText(val)}) ET`
        );
        colX += width;
      }
      this.currentPage.commands.push("Q");
      this.currentY -= rowHeight;
    }
    this.currentY -= 8;
  }

  drawSubInvocationTree(nodes) {
    if (!nodes || nodes.length === 0) {
      this.drawKeyValue("Sub-Invocations", "None (Direct Contract Call)");
      return;
    }

    this.drawSectionTitle(`Sub-Invocation Call Tree (${nodes.length} call${nodes.length > 1 ? "s" : ""})`);

    const rowHeight = 15;

    for (let i = 0; i < nodes.length; i++) {
      this.ensureSpace(rowHeight);
      const item = nodes[i];
      const depth = Math.min(item.depth || 0, 8);
      const indent = depth * 14;

      const isLast = i === nodes.length - 1 || (nodes[i + 1] && nodes[i + 1].depth < depth);
      const branchSymbol = depth === 0 ? "●" : isLast ? "└─" : "├─";

      const contract = item.contract_id || "—";
      const fn = item.function || "—";
      const argsCount = Array.isArray(item.args) ? item.args.length : 0;
      const desc = `${branchSymbol} ${contract}::${fn}(${argsCount} arg${argsCount === 1 ? "" : "s"})`;

      this.currentPage.commands.push(
        "q",
        depth === 0 ? "0.1 0.3 0.6 rg" : "0.3 0.35 0.4 rg",
        `BT /F3 8 Tf ${this.margin + indent} ${this.currentY} Td (${escapePdfText(desc)}) ET`,
        "Q"
      );

      this.currentY -= rowHeight;
    }
    this.currentY -= 6;
  }

  drawVerificationBox() {
    const boxHeight = 70;
    this.ensureSpace(boxHeight + 10);

    const y = this.currentY - boxHeight;

    this.currentPage.commands.push(
      "q",
      "0.96 0.98 1.0 rg", // Light blue tint
      `${this.margin} ${y} ${this.usableWidth} ${boxHeight} re f`,
      "0.2 0.4 0.7 RG", // Border blue
      "1 w",
      `${this.margin} ${y} ${this.usableWidth} ${boxHeight} re s`,
      // Title
      "0.1 0.25 0.55 rg",
      `BT /F2 9 Tf ${this.margin + 10} ${y + boxHeight - 16} Td (AUTHENTICITY & VERIFICATION FOOTER) ET`,
      // SHA-256 Hash
      "0.2 0.25 0.3 rg",
      `BT /F2 7.5 Tf ${this.margin + 10} ${y + boxHeight - 30} Td (Canonical SHA-256:) ET`,
      `BT /F3 7.5 Tf ${this.margin + 105} ${y + boxHeight - 30} Td (${escapePdfText(this.verificationHash || "—")}) ET`,
      // Detached Signature
      `BT /F2 7.5 Tf ${this.margin + 10} ${y + boxHeight - 44} Td (HMAC Signature:) ET`,
      `BT /F3 7.5 Tf ${this.margin + 105} ${y + boxHeight - 44} Td (${escapePdfText(this.signature || "—")}) ET`,
      // Live Permalink
      `BT /F2 7.5 Tf ${this.margin + 10} ${y + boxHeight - 58} Td (Live Explorer Link:) ET`,
      "0.1 0.4 0.8 rg",
      `BT /F1 7.5 Tf ${this.margin + 105} ${y + boxHeight - 58} Td (${escapePdfText(this.permalink || "—")}) ET`,
      "Q"
    );

    this.currentY -= boxHeight + 12;
  }

  compile() {
    // Push the final page
    if (this.currentPage) {
      this.pages.push(this.currentPage);
      this.currentPage = null;
    }

    const totalPages = this.pages.length;

    // Inject footer on each page with resolved totalPages
    for (let i = 0; i < totalPages; i++) {
      const page = this.pages[i];
      const pageNum = i + 1;
      const footerY = this.margin + 14;

      page.commands.push(
        "q",
        "0.7 0.75 0.8 RG",
        "0.5 w",
        `${this.margin} ${footerY + 12} m ${this.pageWidth - this.margin} ${footerY + 12} l S`,
        "0.45 0.5 0.55 rg",
        `BT /F1 7.5 Tf ${this.margin} ${footerY} Td (Generated: ${escapePdfText(this.timestamp)} | Soroban Smart Block Explorer) ET`,
        `BT /F2 8 Tf ${this.pageWidth - this.margin - 65} ${footerY} Td (Page ${pageNum} of ${totalPages}) ET`,
        "Q"
      );
    }

    return this.assemblePdf();
  }

  assemblePdf() {
    const totalPages = this.pages.length;
    const objects = [];
    const xrefOffsets = [];

    // Helper to add object
    const addObject = (content) => {
      objects.push(content);
      return objects.length; // 1-indexed object ID
    };

    // 1: Catalog
    // 2: Pages
    // 3: StructTreeRoot (Tagged PDF for accessibility)
    // 4.. Fonts (F1, F2, F3, F4)
    // Page objects and content streams follow

    // Placeholder for catalog and pages
    const catalogObjId = 1;
    const pagesObjId = 2;
    const structTreeRootObjId = 3;
    const fontF1ObjId = 4;
    const fontF2ObjId = 5;
    const fontF3ObjId = 6;
    const fontF4ObjId = 7;

    // Font definitions (Standard Type 1 fonts - universally deterministic)
    const fontDefs = [
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
      `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`,
      `<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>`,
    ];

    // Page IDs: Start at 8. Each page has a Page object and a Contents stream object.
    const pageObjIds = [];
    let nextId = 8;

    for (let i = 0; i < totalPages; i++) {
      const pageId = nextId++;
      const contentId = nextId++;
      pageObjIds.push({ pageId, contentId });
    }

    // Structure elements for Tagged PDF (Accessibility)
    const structElemObjId = nextId++;

    // 1: Catalog
    const catalogObj = `<< /Type /Catalog /Pages ${pagesObjId} 0 R /StructTreeRoot ${structTreeRootObjId} 0 R /MarkInfo << /Marked true >> /Lang (en-US) >>`;

    // 2: Pages
    const kidsStr = pageObjIds.map((p) => `${p.pageId} 0 R`).join(" ");
    const pagesObj = `<< /Type /Pages /Kids [${kidsStr}] /Count ${totalPages} >>`;

    // 3: StructTreeRoot
    const structTreeRootObj = `<< /Type /StructTreeRoot /RoleMap << /Report /Document /Header /H1 /Table /Table >> /K [${structElemObjId} 0 R] >>`;

    // Add initial metadata objects
    objects.push(catalogObj); // 1
    objects.push(pagesObj); // 2
    objects.push(structTreeRootObj); // 3
    objects.push(fontDefs[0]); // 4: F1
    objects.push(fontDefs[1]); // 5: F2
    objects.push(fontDefs[2]); // 6: F3
    objects.push(fontDefs[3]); // 7: F4

    // Add page and content objects
    for (let i = 0; i < totalPages; i++) {
      const { pageId, contentId } = pageObjIds[i];
      const pageData = this.pages[i];
      const contentStream = pageData.commands.join("\n");
      const streamLen = Buffer.byteLength(contentStream, "utf8");

      // Page object
      const pageObj = `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontF1ObjId} 0 R /F2 ${fontF2ObjId} 0 R /F3 ${fontF3ObjId} 0 R /F4 ${fontF4ObjId} 0 R >> >> /StructParents ${i} >>`;

      // Stream object
      const streamObj = `<< /Length ${streamLen} >>\nstream\n${contentStream}\nendstream`;

      objects.push(pageObj);
      objects.push(streamObj);
    }

    // StructElem object (Accessibility document tag)
    const structElemObj = `<< /Type /StructElem /S /Document /P ${structTreeRootObjId} 0 R /Pg ${pageObjIds[0].pageId} 0 R /K 0 >>`;
    objects.push(structElemObj);

    // Build PDF binary
    let pdf = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";

    for (let i = 0; i < objects.length; i++) {
      xrefOffsets.push(Buffer.byteLength(pdf, "utf8"));
      const objNum = i + 1;
      pdf += `${objNum} 0 obj\n${objects[i]}\nendobj\n`;
    }

    // xref table
    const xrefOffset = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";

    for (const offset of xrefOffsets) {
      const padded = String(offset).padStart(10, "0");
      pdf += `${padded} 00000 n \n`;
    }

    // Trailer
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjId} 0 R /Info << /Title (${escapePdfText(this.title)}) /Producer (Soroban Smart Block Explorer) /CreationDate (D:20260101000000Z) >> >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, "utf8");
  }
}
