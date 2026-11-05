import { TYPE_LABEL } from "../backlog/model";
import { DETAIL_CATEGORY_LABEL, ISSUE_SEVERITY_LABEL, PLATFORM_LABEL, formatTicketId, issueTypeLabel } from "../issues/keys";
import { formatDeadline, sortProjects } from "../projects";
import { STATUS_LABELS } from "../statuses";
import type { Project, Task, User } from "../types";
import { zipStore, type ZipEntry } from "./zip";

const ISSUE_HEADERS = [
  "Project",
  "Client",
  "Deadline",
  "Ticket",
  "Title",
  "Description",
  "Type",
  "Severity",
  "Status",
  "Assignee",
  "Platforms",
  "Created",
  "Updated",
  "Reproduction steps",
  "Expected",
  "Actual",
  "Affected area",
  "Detail category",
  "Photos",
];

const PHOTO_HEADERS = ["Project", "Ticket", "Title", "File name", "Saved as", "Preview"];

export interface ReportPhoto {
  taskId: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
  bytes: Uint8Array;
}

export interface ReportXlsxInput {
  projects: Project[];
  tasks: Task[];
  users: User[];
  photos?: ReportPhoto[];
}

interface PackedPhoto {
  path: string;
  bytes: Uint8Array;
  contentType: string;
  extension: string;
  embed: boolean;
  /** 0-based row on the Photos sheet. */
  row: number;
  savedAs: string;
}

/** Excel workbook of the selected issues. Screenshots are embedded when Excel can show them, and always stored inside the file. */
export function buildReportXlsx(input: ReportXlsxInput): Uint8Array {
  const projects = sortProjects(input.projects);
  const users = new Map(input.users.map((user) => [user.id, user.name]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tasks = [...input.tasks].sort((a, b) => {
    const projectOrder =
      projects.findIndex((project) => project.id === a.projectId) -
      projects.findIndex((project) => project.id === b.projectId);
    if (projectOrder !== 0) return projectOrder;
    return a.ticketNumber - b.ticketNumber || a.title.localeCompare(b.title);
  });
  const photosByTask = new Map<string, ReportPhoto[]>();
  for (const photo of input.photos ?? []) {
    const list = photosByTask.get(photo.taskId) ?? [];
    list.push(photo);
    photosByTask.set(photo.taskId, list);
  }
  for (const list of photosByTask.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.fileName.localeCompare(b.fileName));
  }

  const issueRows: string[][] = [];
  for (const project of projects) {
    const issues = tasks.filter((task) => task.projectId === project.id);
    if (issues.length === 0) {
      issueRows.push(issueCells(project, null, users, ""));
      continue;
    }
    for (const task of issues) {
      const names = (photosByTask.get(task.id) ?? []).map((photo) => photo.fileName).join(", ");
      issueRows.push(issueCells(project, task, users, names));
    }
  }

  const packed: PackedPhoto[] = [];
  const photoRows: string[][] = [];
  let imageNumber = 1;
  for (const task of tasks) {
    const project = projectById.get(task.projectId);
    const shots = photosByTask.get(task.id) ?? [];
    for (const shot of shots) {
      const kind = photoKind(shot.mimeType, shot.fileName, shot.bytes);
      const path = `xl/media/image${imageNumber}.${kind.extension}`;
      imageNumber += 1;
      const row = photoRows.length + 1;
      packed.push({
        path,
        bytes: shot.bytes,
        contentType: kind.contentType,
        extension: kind.extension,
        embed: kind.embed,
        row,
        savedAs: path,
      });
      photoRows.push([
        project?.name ?? "",
        formatTicketId(project?.name, task.ticketNumber),
        task.title.trim() || "Untitled",
        shot.fileName,
        path,
        kind.embed ? "" : `Open ${path} from this workbook (it is a zip)`,
      ]);
    }
  }

  const embedded = packed.filter((photo) => photo.embed);
  const issuesSheet = worksheet(ISSUE_HEADERS, issueRows, ISSUE_WIDTHS, new Set());
  const photoSheet = worksheet(
    PHOTO_HEADERS,
    photoRows.length > 0 ? photoRows : [["No screenshots on these issues."]],
    PHOTO_WIDTHS,
    new Set(embedded.map((photo) => photo.row)),
    embedded.length > 0 ? `<drawing r:id="rId1"/>` : "",
  );
  const files: ZipEntry[] = [
    { name: "[Content_Types].xml", data: xml(contentTypes(packed, embedded.length > 0)) },
    { name: "_rels/.rels", data: xml(rootRels()) },
    { name: "xl/workbook.xml", data: xml(workbookXml()) },
    { name: "xl/_rels/workbook.xml.rels", data: xml(workbookRels()) },
    { name: "xl/styles.xml", data: xml(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: xml(issuesSheet) },
    { name: "xl/worksheets/sheet2.xml", data: xml(photoSheet) },
  ];
  if (embedded.length > 0) {
    files.push(
      { name: "xl/worksheets/_rels/sheet2.xml.rels", data: xml(sheetRels()) },
      { name: "xl/drawings/drawing1.xml", data: xml(drawingXml(embedded)) },
      { name: "xl/drawings/_rels/drawing1.xml.rels", data: xml(drawingRels(embedded)) },
    );
  }
  for (const photo of packed) files.push({ name: photo.path, data: photo.bytes });
  return zipStore(files);
}

export function workbookFilename(projectName: string | null): string {
  if (!projectName) return "arstacksops-all-projects.xlsx";
  const safe = projectName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  return `${safe}.xlsx`;
}

const ISSUE_WIDTHS = [22, 20, 16, 16, 42, 42, 18, 14, 14, 20, 24, 22, 22, 36, 28, 28, 24, 18, 28];
const PHOTO_WIDTHS = [22, 16, 42, 28, 28, 36];

function issueCells(project: Project, task: Task | null, users: Map<string, string>, photos: string): string[] {
  const due = project.deadline ? formatDeadline(project.deadline) : "N/A";
  if (!task) {
    return [project.name, project.client.trim(), due, "", "No issues yet.", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
  }
  const kind =
    task.workItemType === "task" || task.workItemType === "bug"
      ? issueTypeLabel(task.issueType)
      : TYPE_LABEL[task.workItemType];
  const platforms = task.platforms.length ? task.platforms.map((platform) => PLATFORM_LABEL[platform]).join(", ") : "";
  return [
    project.name,
    project.client.trim(),
    due,
    formatTicketId(project.name, task.ticketNumber),
    task.title.trim() || "Untitled",
    task.description.trim(),
    kind,
    task.issueSeverity ? ISSUE_SEVERITY_LABEL[task.issueSeverity] : "",
    STATUS_LABELS[task.status],
    users.get(task.assigneeId) ?? "Unassigned",
    platforms,
    task.createdAt,
    task.updatedAt,
    task.stepsToReproduce.trim(),
    task.expectedBehaviour.trim(),
    task.actualBehaviour.trim(),
    task.affectedArea.trim(),
    task.detailCategory ? DETAIL_CATEGORY_LABEL[task.detailCategory] : "",
    photos,
  ];
}

function photoKind(mime: string, fileName: string, bytes: Uint8Array): { extension: string; contentType: string; embed: boolean } {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { extension: "png", contentType: "image/png", embed: true };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpeg", contentType: "image/jpeg", embed: true };
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { extension: "gif", contentType: "image/gif", embed: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { extension: "bmp", contentType: "image/bmp", embed: true };
  }
  const fromName = fileName.includes(".") ? (fileName.split(".").pop() ?? "") : "";
  const rawExtension = /^[A-Za-z0-9]{1,8}$/.test(fromName) ? fromName.toLowerCase() : "bin";
  const extension = rawExtension === "xml" || rawExtension === "rels" ? "bin" : rawExtension;
  const contentType = mime.trim().replace(/[^A-Za-z0-9.+/-]/g, "") || "application/octet-stream";
  return { extension, contentType, embed: false };
}

function worksheet(headers: string[], rows: string[][], widths: number[], tallRows: Set<number>, footer = ""): string {
  const cols = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const head = `<row r="1">${headers.map((header, index) => cell(1, index, header, true)).join("")}</row>`;
  const body = rows
    .map((row, index) => {
      const number = index + 2;
      const height = tallRows.has(number - 1) ? ` ht="112" customHeight="1"` : "";
      const values = row.map((value, column) => cell(number, column, value, false)).join("");
      return `<row r="${number}"${height}>${values}</row>`;
    })
    .join("");
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${head}${body}</sheetData>${footer}</worksheet>`;
}

function cell(row: number, column: number, value: string, header: boolean): string {
  if (!value) return "";
  const style = header ? ` s="1"` : "";
  return `<c r="${columnName(column)}${row}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function columnName(index: number): string {
  let number = index + 1;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function drawingXml(photos: PackedPhoto[]): string {
  const anchors = photos
    .map((photo, index) => {
      const id = index + 2;
      const extent = `cx="1800000" cy="1333500"`;
      return `<xdr:oneCellAnchor editAs="oneCell"><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${photo.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext ${extent}/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Picture ${index + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${extent}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
    })
    .join("");
  return `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
}

function drawingRels(photos: PackedPhoto[]): string {
  const rels = photos
    .map(
      (photo, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${photo.path.slice("xl/media/".length)}"/>`,
    )
    .join("");
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function contentTypes(photos: PackedPhoto[], hasDrawing: boolean): string {
  const defaults = new Map<string, string>([
    ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["xml", "application/xml"],
  ]);
  for (const photo of photos) {
    if (!defaults.has(photo.extension)) defaults.set(photo.extension, photo.contentType);
  }
  const defaultXml = [...defaults]
    .map(([extension, contentType]) => `<Default Extension="${extension}" ContentType="${escapeXml(contentType)}"/>`)
    .join("");
  const drawing = hasDrawing
    ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    : "";
  return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaultXml}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${drawing}</Types>`;
}

function rootRels(): string {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function workbookXml(): string {
  return `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Issues" sheetId="1" r:id="rId1"/><sheet name="Photos" sheetId="2" r:id="rId2"/></sheets></workbook>`;
}

function workbookRels(): string {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function sheetRels(): string {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
}

function stylesXml(): string {
  return `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
}

function xml(body: string): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`);
}
