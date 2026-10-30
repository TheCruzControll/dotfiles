import path from "node:path";
import { pathToFileURL } from "node:url";

const PATH_PATTERN =
  /(?:~[\\/]|\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])?[\w.@+-]+(?:[\\/][\w.@()+\[\]-]+)*[\\/][\w.@()+\[\]-]+\.[A-Za-z]\w*(?::\d+){0,2}/g;

let workingDirectory = process.cwd();

function resolvePathToken(token: string, cwd: string): string {
  const lineSuffix = token.match(/(?::\d+){1,2}$/)?.[0] ?? "";
  let filePath = lineSuffix ? token.slice(0, -lineSuffix.length) : token;
  if (filePath.startsWith("~/")) {
    filePath = path.join(process.env.HOME ?? "", filePath.slice(2));
  }
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  return `${pathToFileURL(absolutePath).href}${lineSuffix}`;
}

function asMarkdownLink(label: string, token: string, cwd: string): string {
  const escapedLabel = label.replace(/[\\\[\]]/g, "\\$&");
  return `[${escapedLabel}](${resolvePathToken(token, cwd)})`;
}

function stash(text: string, saved: string[]): string {
  const index = saved.push(text) - 1;
  return `\u0000PI_PATH_LINK_${index}\u0000`;
}

function protectFencedCode(markdown: string, saved: string[]): string {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let result = "";
  let block = "";
  let fence: { character: string; length: number } | undefined;

  for (const line of lines) {
    const content = line.replace(/\r?\n$/, "");
    if (!fence) {
      const opening = content.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!opening) {
        result += line;
        continue;
      }
      fence = { character: opening[1][0], length: opening[1].length };
      block = line;
      continue;
    }

    block += line;
    const closing = content.match(/^ {0,3}(`+|~+)[ \t]*$/);
    if (
      closing &&
      closing[1][0] === fence.character &&
      closing[1].length >= fence.length
    ) {
      result += stash(block, saved);
      block = "";
      fence = undefined;
    }
  }

  if (block) result += stash(block, saved);
  return result;
}

function isPathToken(value: string): boolean {
  PATH_PATTERN.lastIndex = 0;
  const match = PATH_PATTERN.exec(value);
  return match?.[0] === value && PATH_PATTERN.lastIndex === value.length;
}

function linkifyText(text: string, cwd: string): string {
  PATH_PATTERN.lastIndex = 0;
  return text.replace(PATH_PATTERN, (token, offset: number, whole: string) => {
    const previous = whole[offset - 1] ?? "";
    // Do not link path-like suffixes inside URLs or larger words.
    if (/[\w/:.\\-]/.test(previous)) return token;
    return asMarkdownLink(token, token, cwd);
  });
}

export function makePathsClickable(markdown: string, cwd = process.cwd()): string {
  const saved: string[] = [];
  let text = protectFencedCode(markdown, saved);

  // Keep existing Markdown links intact rather than nesting another link in them.
  text = text.replace(/\[[^\]\n]*\]\([^\n)]*\)/g, (link) => stash(link, saved));

  // Standalone inline-code paths remain code-styled, but become clickable.
  text = text.replace(/(`+)([^`\n]*?)\1/g, (code, _ticks, inner: string) => {
    const token = inner.trim();
    if (isPathToken(token)) return stash(asMarkdownLink(code, token, cwd), saved);
    return stash(code, saved);
  });

  text = linkifyText(text, cwd);
  return text.replace(/\u0000PI_PATH_LINK_(\d+)\u0000/g, (_placeholder, index: string) => saved[Number(index)]);
}

export default function (pi: any): void {
  pi.on("session_start", (_event: unknown, ctx: { cwd: string }) => {
    workingDirectory = ctx.cwd;
  });
  pi.on("message_end", (_event: unknown, ctx: { cwd: string }) => {
    workingDirectory = ctx.cwd;
  });

  pi.registerMarkdownTransformer((markdown: string, context: { messageType: string }) => {
    if (context.messageType === "assistant-thinking") return markdown;
    return makePathsClickable(markdown, workingDirectory);
  });
}
