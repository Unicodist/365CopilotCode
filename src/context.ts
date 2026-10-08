import * as path from "path";
import * as vscode from "vscode";
import ignore, { type Ignore } from "ignore";

/** Why a file was picked as context, in priority order. */
export type ContextReason = "selection" | "reference" | "active" | "open" | "related";

export interface ContextFile {
  uri: vscode.Uri;
  /** Workspace-relative path (or file name) shown to Copilot and the user. */
  label: string;
  languageId: string;
  content: string;
  reason: ContextReason;
  /** 1-based, inclusive line range when only part of the file is sent. */
  lines?: { start: number; end: number };
  truncated?: boolean;
}

export interface ContextSettings {
  /** Total characters of file content sent with one question. */
  maxCharacters: number;
  includeWorkspaceFiles: boolean;
  /** Most workspace files (open tabs and related files) added on top of the active file. */
  maxWorkspaceFiles: number;
  /** Extra glob patterns never sent as context. */
  exclude: string[];
}

export interface PackedContext {
  files: ContextFile[];
  /** Labels of files that did not fit in the budget. */
  omitted: string[];
}

export interface GatherOptions {
  /** Files or ranges the user attached explicitly (for example with `#file` in chat). */
  references?: readonly (vscode.Uri | vscode.Location)[];
  token?: vscode.CancellationToken;
}

/** Folders that are never useful context and are often huge. */
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/out/**",
  "**/dist/**",
  "**/build/**",
  "**/.vscode-test/**",
  "**/*.vsix",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
];

/** Files that commonly hold secrets; they are only sent when the user attaches them explicitly. */
const SENSITIVE = [
  /(^|\/)\.env(\..*)?$/i,
  /\.(pem|key|pfx|p12|keystore|jks)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)credentials(\.\w+)?$/i,
  /(^|\/)secrets?(\.\w+)?$/i,
];

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LISTED_FILES = 5000;

const STOP_WORDS = new Set(
  "the and for with this that what why how does into from have has are was were can could should would will about which where when there their them then than file files code function method class make add use using need want please help explain fix bug error work".split(
    " ",
  ),
);

export function readContextSettings(): ContextSettings {
  const config = vscode.workspace.getConfiguration("365CopilotCode.context");
  return {
    maxCharacters: Math.max(1000, config.get<number>("maxCharacters", 40000)),
    includeWorkspaceFiles: config.get<boolean>("includeWorkspaceFiles", true),
    maxWorkspaceFiles: Math.max(0, config.get<number>("maxWorkspaceFiles", 5)),
    exclude: config.get<string[]>("exclude", []),
  };
}

export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return SENSITIVE.some((re) => re.test(normalized));
}

/** Words from the question worth matching against file paths, lower-cased. */
export function questionKeywords(question: string): string[] {
  const words = new Set<string>();
  for (const match of question.matchAll(/[A-Za-z_][\w.-]*/g)) {
    const word = match[0].replace(/[.-]+$/, "");
    // Also split camelCase and snake_case so "AuthManager" matches "auth.ts".
    const parts = [word, ...word.split(/[._-]|(?<=[a-z0-9])(?=[A-Z])/)];
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower.length >= 3 && !STOP_WORDS.has(lower)) {
        words.add(lower);
      }
    }
  }
  return [...words];
}

/** Relative module specifiers imported by a source file (`./x`, `../y/z`). */
export function relativeImports(source: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s+["'](\.{1,2}\/[^"']+)["']/g,
    /\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) {
      specs.add(match[1]);
    }
  }
  return [...specs];
}

/**
 * Scores workspace files by how likely they are to help answer the question: files the
 * active file imports, then files whose name or path matches words in the question.
 * Returns paths with a positive score, best first.
 */
export function rankRelatedFiles(
  question: string,
  candidates: readonly string[],
  active?: { path: string; content: string },
): string[] {
  const keywords = questionKeywords(question);
  const imported = new Set<string>();
  if (active) {
    const dir = path.posix.dirname(active.path);
    for (const spec of relativeImports(active.content)) {
      const resolved = path.posix.normalize(path.posix.join(dir, spec));
      imported.add(stripExtension(resolved));
      imported.add(stripExtension(path.posix.join(resolved, "index")));
    }
  }

  const scored: { path: string; score: number }[] = [];
  for (const candidate of candidates) {
    if (active && candidate === active.path) {
      continue;
    }
    let score = 0;
    if (imported.has(stripExtension(candidate))) {
      score += 3;
    }
    const base = stripExtension(path.posix.basename(candidate)).toLowerCase();
    const lowerPath = candidate.toLowerCase();
    for (const word of keywords) {
      if (base === word || path.posix.basename(lowerPath) === word) {
        score += 3;
      } else if (base.includes(word)) {
        score += 2;
      } else if (lowerPath.includes(word)) {
        score += 1;
      }
    }
    if (score > 0) {
      scored.push({ path: candidate, score });
    }
  }
  // Prefer higher scores, then shallower and shorter paths.
  scored.sort((a, b) => b.score - a.score || depth(a.path) - depth(b.path) || a.path.length - b.path.length);
  return scored.map((s) => s.path);
}

function stripExtension(p: string): string {
  const ext = path.posix.extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}

function depth(p: string): number {
  return p.split("/").length;
}

/**
 * Fits files into a character budget in the order given. A file that does not fit whole is
 * cut down when enough room is left to be useful; otherwise it is omitted.
 */
export function packContext(files: readonly ContextFile[], maxCharacters: number): PackedContext {
  const packed: ContextFile[] = [];
  const omitted: string[] = [];
  let remaining = maxCharacters;
  for (const file of files) {
    if (file.content.length <= remaining) {
      packed.push(file);
      remaining -= file.content.length;
    } else if (remaining >= 500) {
      packed.push({ ...file, content: cutAtLine(file.content, remaining), truncated: true });
      remaining = 0;
    } else {
      omitted.push(file.label);
    }
  }
  return { files: packed, omitted };
}

function cutAtLine(text: string, max: number): string {
  const cut = text.slice(0, max);
  const lastNewline = cut.lastIndexOf("\n");
  return lastNewline > max / 2 ? cut.slice(0, lastNewline + 1) : cut;
}

/** Formats one file as a block of text for Copilot. */
export function formatContextFile(file: ContextFile): string {
  const where = file.lines ? ` (lines ${file.lines.start}-${file.lines.end})` : "";
  const note = file.truncated ? "\n[File truncated to fit the context budget.]" : "";
  const fence = file.content.includes("```") ? "````" : "```";
  return `File: ${file.label}${where}\n${fence}${file.languageId}\n${file.content}${file.content.endsWith("\n") ? "" : "\n"}${fence}${note}`;
}

export function describeReason(file: ContextFile): string {
  switch (file.reason) {
    case "selection":
      return `Code the user has selected in ${file.label}`;
    case "reference":
      return `File the user attached: ${file.label}`;
    case "active":
      return `File open in the user's editor: ${file.label}`;
    case "open":
      return `File open in another editor tab: ${file.label}`;
    case "related":
      return `Workspace file related to the question: ${file.label}`;
  }
}

/** Matches workspace-relative paths against each folder's .gitignore files. */
class GitignoreFilter {
  /** Directory (relative to the workspace folder, "" for the root) → its rules. */
  private readonly rules = new Map<string, Ignore>();

  static async load(folder: vscode.WorkspaceFolder, exclude: string): Promise<GitignoreFilter> {
    const filter = new GitignoreFilter();
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/.gitignore"), exclude, 200);
    for (const uri of files) {
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        const dir = path.posix.dirname(toPosix(path.relative(folder.uri.fsPath, uri.fsPath)));
        filter.rules.set(dir === "." ? "" : dir, ignore().add(text));
      } catch {
        // An unreadable .gitignore just doesn't filter anything.
      }
    }
    return filter;
  }

  ignores(relativePath: string): boolean {
    for (const [dir, rules] of this.rules) {
      if (dir === "") {
        if (rules.ignores(relativePath)) {
          return true;
        }
      } else if (relativePath.startsWith(dir + "/") && rules.ignores(relativePath.slice(dir.length + 1))) {
        return true;
      }
    }
    return false;
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Glob of everything never sent: defaults, `files.exclude` and the user's own excludes. */
function excludeGlob(folder: vscode.WorkspaceFolder | undefined, extra: string[]): string {
  const patterns = new Set([...DEFAULT_EXCLUDES, ...extra]);
  const filesExclude = vscode.workspace.getConfiguration("files", folder).get<Record<string, unknown>>("exclude") ?? {};
  for (const [pattern, enabled] of Object.entries(filesExclude)) {
    if (enabled === true) {
      patterns.add(pattern);
    }
  }
  return `{${[...patterns].join(",")}}`;
}

/**
 * Decides whether a file may be sent and gives its label, applying `files.exclude`,
 * `.gitignore` and the extension's own excludes. One instance per question, so .gitignore
 * files are read once.
 */
class WorkspaceFiles {
  private readonly gitignores = new Map<string, Promise<GitignoreFilter>>();

  constructor(private readonly settings: ContextSettings) {}

  label(uri: vscode.Uri): string {
    return uri.scheme === "untitled" ? uri.path : vscode.workspace.asRelativePath(uri, true);
  }

  async isExcluded(uri: vscode.Uri): Promise<boolean> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return false;
    }
    const relative = toPosix(path.relative(folder.uri.fsPath, uri.fsPath));
    // Let VS Code's own glob matcher decide: search for exactly this path with the excludes applied.
    const exact = relative.replace(/[[\]{}*?]/g, "[$&]");
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, exact), excludeGlob(folder, this.settings.exclude), 1);
    if (found.length === 0) {
      return true;
    }
    return (await this.gitignore(folder)).ignores(relative);
  }

  gitignore(folder: vscode.WorkspaceFolder): Promise<GitignoreFilter> {
    let filter = this.gitignores.get(folder.uri.toString());
    if (!filter) {
      filter = GitignoreFilter.load(folder, excludeGlob(folder, this.settings.exclude));
      this.gitignores.set(folder.uri.toString(), filter);
    }
    return filter;
  }

  /** Every file in the workspace that may be sent, as workspace-relative paths. */
  async list(token?: vscode.CancellationToken): Promise<Map<string, vscode.Uri>> {
    const result = new Map<string, vscode.Uri>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*"),
        excludeGlob(folder, this.settings.exclude),
        MAX_LISTED_FILES,
        token,
      );
      const gitignore = await this.gitignore(folder);
      for (const uri of uris) {
        const relative = toPosix(path.relative(folder.uri.fsPath, uri.fsPath));
        if (!gitignore.ignores(relative) && !isSensitivePath(relative)) {
          result.set(this.label(uri), uri);
        }
      }
    }
    return result;
  }
}

async function readFile(uri: vscode.Uri): Promise<{ content: string; languageId: string } | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) {
    return { content: open.getText(), languageId: open.languageId };
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_FILE_BYTES) {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.includes(0)) {
      return undefined; // binary
    }
    return { content: new TextDecoder().decode(bytes), languageId: languageFromPath(uri.path) };
  } catch {
    return undefined;
  }
}

function languageFromPath(p: string): string {
  const ext = path.posix.extname(p).slice(1).toLowerCase();
  const known: Record<string, string> = { ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact", py: "python", cs: "csharp", rb: "ruby", rs: "rust", md: "markdown", yml: "yaml", sh: "shellscript" };
  return known[ext] ?? ext;
}

/**
 * Collects the files to send with a question, best first: the selection, files the user
 * attached, the active file, other open tabs, then workspace files related to the question.
 * Call {@link packContext} on the result to fit it to the budget.
 */
export async function gatherContext(question: string, options: GatherOptions = {}, settings = readContextSettings()): Promise<ContextFile[]> {
  const workspace = new WorkspaceFiles(settings);
  const files: ContextFile[] = [];
  const seen = new Set<string>();
  const add = (file: ContextFile) => {
    const key = file.uri.toString() + (file.lines ? `#${file.lines.start}-${file.lines.end}` : "");
    if (!seen.has(key)) {
      seen.add(key);
      files.push(file);
    }
  };

  const editor = vscode.window.activeTextEditor;
  const activeDoc = editor?.document;
  const activeUsable = activeDoc && !isSensitivePath(activeDoc.uri.path) && !(await workspace.isExcluded(activeDoc.uri));

  // 1. The selection, when there is one.
  if (editor && activeDoc && activeUsable && !editor.selection.isEmpty) {
    const sel = editor.selection;
    add({
      uri: activeDoc.uri,
      label: workspace.label(activeDoc.uri),
      languageId: activeDoc.languageId,
      content: activeDoc.getText(sel),
      reason: "selection",
      lines: { start: sel.start.line + 1, end: sel.end.line + 1 },
    });
  }

  // 2. Anything the user attached. These are sent even when ignored: the user chose them.
  for (const ref of options.references ?? []) {
    const uri = ref instanceof vscode.Uri ? ref : ref.uri;
    const read = await readFile(uri);
    if (!read) {
      continue;
    }
    if (ref instanceof vscode.Location) {
      const lines = read.content.split("\n").slice(ref.range.start.line, ref.range.end.line + 1);
      add({ uri, label: workspace.label(uri), languageId: read.languageId, content: lines.join("\n"), reason: "reference", lines: { start: ref.range.start.line + 1, end: ref.range.end.line + 1 } });
    } else {
      add({ uri, label: workspace.label(uri), languageId: read.languageId, content: read.content, reason: "reference" });
    }
  }

  // 3. The whole active file.
  if (activeDoc && activeUsable) {
    add({ uri: activeDoc.uri, label: workspace.label(activeDoc.uri), languageId: activeDoc.languageId, content: activeDoc.getText(), reason: "active" });
  }

  if (!settings.includeWorkspaceFiles || settings.maxWorkspaceFiles === 0) {
    return files;
  }
  let budget = settings.maxWorkspaceFiles;

  // 4. Other files open in editor tabs.
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (budget === 0 || options.token?.isCancellationRequested) {
        break;
      }
      const input = tab.input;
      if (!(input instanceof vscode.TabInputText) || input.uri.toString() === activeDoc?.uri.toString()) {
        continue;
      }
      if (seen.has(input.uri.toString()) || isSensitivePath(input.uri.path) || (await workspace.isExcluded(input.uri))) {
        continue;
      }
      const read = await readFile(input.uri);
      if (read) {
        add({ uri: input.uri, label: workspace.label(input.uri), languageId: read.languageId, content: read.content, reason: "open" });
        budget--;
      }
    }
  }

  // 5. Workspace files the active file imports or whose names match the question.
  if (budget > 0 && !options.token?.isCancellationRequested) {
    const all = await workspace.list(options.token);
    const active = activeDoc && activeUsable ? { path: workspace.label(activeDoc.uri), content: activeDoc.getText() } : undefined;
    for (const label of rankRelatedFiles(question, [...all.keys()], active)) {
      if (budget === 0) {
        break;
      }
      const uri = all.get(label)!;
      if (seen.has(uri.toString())) {
        continue;
      }
      const read = await readFile(uri);
      if (read) {
        add({ uri, label, languageId: read.languageId, content: read.content, reason: "related" });
        budget--;
      }
    }
  }

  return files;
}
