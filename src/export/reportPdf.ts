import { TYPE_LABEL } from "../backlog/model";
import { ISSUE_SEVERITY_LABEL, PLATFORM_LABEL, formatTicketId, issueTypeLabel } from "../issues/keys";
import { formatDeadline, sortProjects } from "../projects";
import { STATUS_LABELS } from "../statuses";
import type { Project, Task, User } from "../types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const NAVY: Rgb = [0.06, 0.12, 0.25];
const ORANGE: Rgb = [0.92, 0.52, 0.21];
const INK: Rgb = [0.12, 0.14, 0.18];
const MUTED: Rgb = [0.35, 0.4, 0.48];

type Rgb = [number, number, number];

export interface ReportPdfInput {
  projects: Project[];
  tasks: Task[];
  users: User[];
  exportedAt?: Date;
}

/** A readable PDF of the board. This is for opening and reading, not for importing back. */
export function buildReportPdf(input: ReportPdfInput): Uint8Array {
  const exportedAt = input.exportedAt ?? new Date();
  const doc = new ReportDocument(exportedAt);
  const projects = sortProjects(input.projects);
  const users = new Map(input.users.map((user) => [user.id, user.name]));

  doc.heading("Work items");
  const projectLabel = projects.length === 1 ? "1 project" : `${projects.length} projects`;
  const issueLabel = input.tasks.length === 1 ? "1 issue" : `${input.tasks.length} issues`;
  doc.paragraph(`${issueLabel} across ${projectLabel}.`, 11, MUTED);

  for (const project of projects) {
    const issues = input.tasks
      .filter((task) => task.projectId === project.id)
      .sort((a, b) => a.ticketNumber - b.ticketNumber || a.title.localeCompare(b.title));
    const client = project.client.trim() || "No client yet";
    const due = project.deadline ? `Due ${formatDeadline(project.deadline)}` : "Deadline N/A";
    doc.heading(project.name);
    doc.paragraph(`${client} | ${due} | ${issues.length} ${issues.length === 1 ? "issue" : "issues"}`, 10, MUTED);
    if (issues.length === 0) {
      doc.paragraph("No issues yet.", 10, MUTED);
      continue;
    }
    for (const task of issues) {
      const ticket = formatTicketId(project.name, task.ticketNumber);
      const severity = task.issueSeverity ? ISSUE_SEVERITY_LABEL[task.issueSeverity] : "Not set";
      const platforms = task.platforms.length
        ? task.platforms.map((platform) => PLATFORM_LABEL[platform]).join(", ")
        : "No platform";
      const assignee = users.get(task.assigneeId) ?? "Unassigned";
      const kind =
        task.workItemType === "task" || task.workItemType === "bug"
          ? issueTypeLabel(task.issueType)
          : TYPE_LABEL[task.workItemType];
      const meta = [kind, severity, STATUS_LABELS[task.status], assignee, platforms].join(" | ");
      doc.issue(ticket, task.title.trim() || "Untitled", meta, task.description.trim());
    }
  }

  return doc.toPdf();
}

class ReportDocument {
  private pages: string[] = [];
  private ops: string[] = [];
  private y = 0;
  private readonly stamp: string;

  constructor(exportedAt: Date) {
    this.stamp = exportedAt.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    this.startPage();
  }

  heading(text: string) {
    this.ensure(28);
    this.y -= 6;
    this.draw(text, MARGIN, 14, "F2", NAVY);
    this.y -= 18;
  }

  paragraph(text: string, size: number, color: Rgb) {
    for (const line of wrap(text, size, PAGE_WIDTH - MARGIN * 2)) {
      this.ensure(size + 4);
      this.draw(line, MARGIN, size, "F1", color);
      this.y -= size + 4;
    }
  }

  issue(ticket: string, title: string, meta: string, description: string) {
    const titleLines = wrap(`${ticket}  ${title}`, 11, PAGE_WIDTH - MARGIN * 2);
    const metaLines = wrap(meta, 9, PAGE_WIDTH - MARGIN * 2);
    const detail = description ? wrap(description, 9, PAGE_WIDTH - MARGIN * 2).slice(0, 2) : [];
    const height = titleLines.length * 14 + metaLines.length * 12 + detail.length * 12 + 8;
    this.ensure(height);
    titleLines.forEach((line, index) => {
      this.draw(line, MARGIN, 11, index === 0 ? "F2" : "F1", index === 0 ? ORANGE : INK);
      this.y -= 14;
    });
    for (const line of metaLines) {
      this.draw(line, MARGIN, 9, "F1", MUTED);
      this.y -= 12;
    }
    for (const line of detail) {
      this.draw(line, MARGIN, 9, "F1", INK);
      this.y -= 12;
    }
    this.y -= 6;
  }

  toPdf(): Uint8Array {
    this.finishPage();
    return assemblePdf(this.pages);
  }

  private startPage() {
    this.ops = [];
    this.y = PAGE_HEIGHT - MARGIN;
    this.draw("ARStacksOps", MARGIN, 16, "F2", NAVY);
    this.draw(this.stamp, 360, 10, "F1", MUTED);
    this.y -= 22;
    this.ops.push(`0.75 0.78 0.82 RG ${MARGIN} ${this.y} m ${PAGE_WIDTH - MARGIN} ${this.y} l S`);
    this.y -= 18;
  }

  private finishPage() {
    const pageNumber = this.pages.length + 1;
    this.draw(`Page ${pageNumber}`, MARGIN, 9, "F1", MUTED, 32);
    this.pages.push(this.ops.join("\n"));
    this.ops = [];
  }

  private ensure(height: number) {
    if (this.y - height >= MARGIN + 16) return;
    this.finishPage();
    this.startPage();
  }

  private draw(text: string, x: number, size: number, font: "F1" | "F2", color: Rgb, baseline = this.y) {
    const [r, g, b] = color;
    this.ops.push(
      `${round(r)} ${round(g)} ${round(b)} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${round(baseline)} Tm (${escapePdf(text)}) Tj ET`,
    );
  }
}

function wrap(text: string, size: number, width: number): string[] {
  const max = Math.max(12, Math.floor(width / (size * 0.5)));
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length === 1 && words[0] === "") return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const pieces = word.length > max ? word.match(new RegExp(`.{1,${max}}`, "g")) ?? [word] : [word];
    for (const piece of pieces) {
      const next = line ? `${line} ${piece}` : piece;
      if (next.length > max && line) {
        lines.push(line);
        line = piece;
      } else {
        line = next;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapePdf(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function round(value: number): string {
  return value.toFixed(2);
}

function assemblePdf(streams: string[]): Uint8Array {
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets = [0];
  let cursor = chunks[0].length;

  function add(body: string) {
    offsets.push(cursor);
    const piece = `${offsets.length - 1} 0 obj\n${body}\nendobj\n`;
    chunks.push(piece);
    cursor += piece.length;
  }

  const pageIds: number[] = [];
  const contentIds: number[] = [];
  let nextId = 5;
  for (let index = 0; index < streams.length; index += 1) {
    pageIds.push(nextId);
    contentIds.push(nextId + 1);
    nextId += 2;
  }

  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${streams.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  streams.forEach((stream, index) => {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
    );
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF`;
  chunks.push(xref);
  return new TextEncoder().encode(chunks.join(""));
}
