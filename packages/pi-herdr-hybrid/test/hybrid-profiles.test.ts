import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentDefinition, resolveEffectiveSessionMode } from '../src/agents.ts';
test('legacy selected profile settings map to native Herdr settings',()=>{
  const profile=parseAgentDefinition('---\nname: oracle\nsystemPromptMode: replace\ndefaultContext: fork\ninheritSkills: false\n---\nRead-only advice','oracle')!;
  assert.equal(profile.systemPromptMode,'replace'); assert.equal(profile.sessionMode,'fork'); assert.equal(profile.inheritSkills,false);
  assert.equal(resolveEffectiveSessionMode({},profile),'fork');
});

test('bundled reviewer is shell-free hybrid-native and requires a parent diff artifact', () => {
  const text = readFileSync(new URL('../agents/reviewer.md', import.meta.url), 'utf8');
  const reviewer = parseAgentDefinition(text, 'reviewer')!;
  assert.equal(reviewer.tools, 'read, grep, find, ls');
  assert.ok(!/watchdog_diff|contact_supervisor/.test(text));
  assert.match(text, /parent-supplied diff artifact/);
  assert.match(text, /subagent_done/);
  const prompt = readFileSync(new URL('../prompts/implement-review.md', import.meta.url), 'utf8');
  assert.match(prompt, /parent capture the diff artifact/);
});
test('council resume examples use message, never task', () => {
  for (const path of ['../README.md', '../skills/council-mode/SKILL.md', '../skills/council-mode/references/pass-contracts.md']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(!/subagent_resume\([^\n]*\btask\b|curated `task`/.test(text), path);
    assert.match(text, /message/);
  }
});
