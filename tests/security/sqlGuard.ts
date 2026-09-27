/**
 * Static check for SQL built from interpolated values (spec 2026-09-27-security-hardening, §1).
 *
 * A template literal or `+` concatenation whose text looks like SQL may only interpolate:
 * - placeholder numbers: `$${n}` where `n` is arithmetic over identifiers (`$${params.length + 1}`);
 * - expressions explicitly allowlisted for that file (constants, whitelisted fragments).
 * Anything else is reported: request values must travel as placeholders.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

/** Uppercase SQL keywords; lowercase prose ("select a region") does not count. */
export const SQL_KEYWORDS_RE =
  /\b(SELECT|INSERT|UPDATE|DELETE|WHERE|INTERVAL|FROM|JOIN|AND|OR|ORDER BY|GROUP BY|LIMIT|OFFSET|VALUES|SET|RETURNING|ON CONFLICT)\b/;

/** `$${…}`: a placeholder number — arithmetic over plain identifiers, `x.length` and integers. */
const TERM = String.raw`(?:[A-Za-z_]\w*(?:\.length)?|\d+)`;
const PLACEHOLDER_EXPR_RE = new RegExp(String.raw`^${TERM}(?:\+\+)?(?:\s*[-+*]\s*${TERM})*$`);

export type Allowlist = Record<string, string[]>;

export interface SqlFinding {
  file: string;
  line: number;
  expression: string;
}

export interface ScanResult {
  findings: SqlFinding[];
  /** Allowlist entries (`file: expression`) that matched something. */
  used: Set<string>;
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

function templateStaticText(node: ts.TemplateExpression): string {
  return node.head.text + node.templateSpans.map(s => s.literal.text).join('');
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return templateStaticText(node);
  return null;
}

function flattenPlus(node: ts.Expression, out: ts.Expression[] = []): ts.Expression[] {
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    flattenPlus(inner.left, out);
    flattenPlus(inner.right, out);
  } else {
    out.push(node);
  }
  return out;
}

const isPlus = (node: ts.Node) =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;

export function scanSource(file: string, source: string, allowlist: Allowlist = {}, result?: ScanResult): ScanResult {
  const out = result ?? { findings: [], used: new Set<string>() };
  const allowed = new Set(allowlist[file] ?? []);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const checkedTemplates = new Set<ts.Node>();

  const reported = new Set<number>();
  const report = (expr: ts.Node) => {
    if (reported.has(expr.getStart(sf))) return;
    reported.add(expr.getStart(sf));
    const text = normalize(expr.getText(sf));
    if (allowed.has(text)) {
      out.used.add(`${file}: ${text}`);
      return;
    }
    const line = sf.getLineAndCharacterOfPosition(expr.getStart(sf)).line + 1;
    out.findings.push({ file, line, expression: text });
  };

  const checkTemplate = (node: ts.TemplateExpression) => {
    if (checkedTemplates.has(node)) return;
    checkedTemplates.add(node);
    let before = node.head.text;
    for (const span of node.templateSpans) {
      const expr = normalize(span.expression.getText(sf));
      if (!(before.endsWith('$') && PLACEHOLDER_EXPR_RE.test(expr))) report(span.expression);
      before = span.literal.text;
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node) && SQL_KEYWORDS_RE.test(templateStaticText(node))) checkTemplate(node);

    // Top of an `a + b + c` chain that contains SQL text: every non-literal operand must be allowed
    if (isPlus(node) && !isPlus(node.parent)) {
      const operands = flattenPlus(node as ts.Expression);
      if (operands.some(o => SQL_KEYWORDS_RE.test(literalText(o) ?? ''))) {
        for (const o of operands) {
          if (ts.isTemplateExpression(o)) checkTemplate(o);
          else if (literalText(o) === null) report(o);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(full);
  }
  return files.sort();
}

export function scanDirectory(root: string, dir: string, allowlist: Allowlist): ScanResult {
  const result: ScanResult = { findings: [], used: new Set() };
  for (const full of listTsFiles(dir)) {
    const rel = path.relative(root, full).split(path.sep).join('/');
    scanSource(rel, fs.readFileSync(full, 'utf8'), allowlist, result);
  }
  return result;
}
