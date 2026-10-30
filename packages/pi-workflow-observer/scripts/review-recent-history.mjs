import fs from "node:fs";
import path from "node:path";

import { analyzeConversation, formatSuggestionLines } from "../extension/workflow-observer/lib/analyzer.js";

const filePath = path.resolve("history/recent-conversation.md");
const markdown = fs.readFileSync(filePath, "utf8");

const entryPattern = /^##\s+.+?·\s+(user|assistant)\s+·\s+entry\s+([0-9a-f]+)\s*$/gim;
const matches = [...markdown.matchAll(entryPattern)];
const messages = [];

for (let index = 0; index < matches.length; index += 1) {
  const match = matches[index];
  const role = match[1];
  const id = match[2];
  const start = match.index + match[0].length;
  const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
  const text = markdown.slice(start, end).trim();
  if (!text) {
    continue;
  }
  messages.push({ id, role, text });
}

const suggestions = analyzeConversation(
  messages,
  { seenFingerprints: new Set(), dismissedFingerprints: new Set() },
  {
    enabled: true,
    minNewMessages: 6,
    cooldownMs: 15 * 60 * 1000,
    maxMessages: 40,
    maxSuggestionsPerRun: 5,
  },
);

console.log(`Parsed ${messages.length} messages from ${filePath}`);
console.log("");
console.log(formatSuggestionLines(suggestions).join("\n"));
