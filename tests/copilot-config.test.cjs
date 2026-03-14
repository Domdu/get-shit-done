/**
 * GSD Tools Tests - copilot-config.test.cjs
 *
 * Tests for Copilot CLI: tool mapping, skill/agent conversion,
 * plugin.json and hooks.json generation.
 */

process.env.GSD_TEST_MODE = '1';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');

const {
  claudeToCopilotTools,
  convertCopilotToolName,
  convertSlashCommandsToCopilotSkillMentions,
  convertClaudeToCopilotMarkdown,
  convertClaudeCommandToCopilotSkill,
  convertClaudeAgentToCopilotAgent,
  generateCopilotPluginJson,
  generateCopilotHooksJson,
} = require('../bin/install.js');

// ─── convertCopilotToolName ───────────────────────────────────────────────────

describe('convertCopilotToolName', () => {
  test('maps known Claude tools to Copilot names', () => {
    assert.strictEqual(convertCopilotToolName('Read'), 'view');
    assert.strictEqual(convertCopilotToolName('Write'), 'edit');
    assert.strictEqual(convertCopilotToolName('Edit'), 'edit');
    assert.strictEqual(convertCopilotToolName('Bash'), 'bash');
    assert.strictEqual(convertCopilotToolName('Glob'), 'glob');
    assert.strictEqual(convertCopilotToolName('Grep'), 'rg');
    assert.strictEqual(convertCopilotToolName('Task'), 'task');
    assert.strictEqual(convertCopilotToolName('AskUserQuestion'), 'ask_user');
    assert.strictEqual(convertCopilotToolName('WebFetch'), 'fetch');
    assert.strictEqual(convertCopilotToolName('TodoWrite'), 'todowrite');
  });

  test('leaves MCP tools unchanged', () => {
    assert.strictEqual(convertCopilotToolName('mcp__foo__bar'), 'mcp__foo__bar');
  });

  test('lowercases unknown tools', () => {
    assert.strictEqual(convertCopilotToolName('UnknownTool'), 'unknowntool');
  });
});

// ─── convertSlashCommandsToCopilotSkillMentions ───────────────────────────────

describe('convertSlashCommandsToCopilotSkillMentions', () => {
  test('converts /gsd:command to /gsd-command', () => {
    const result = convertSlashCommandsToCopilotSkillMentions('Run /gsd:execute-phase 1');
    assert.ok(result.includes('/gsd-execute-phase'));
    assert.ok(!result.includes('/gsd:execute-phase'));
  });

  test('converts /gsd-help to /gsd-help', () => {
    const result = convertSlashCommandsToCopilotSkillMentions('See /gsd-help for usage');
    assert.ok(result.includes('/gsd-help'));
  });

  test('handles multiple commands', () => {
    const result = convertSlashCommandsToCopilotSkillMentions('Do /gsd:new-project then /gsd:plan-phase 1');
    assert.ok(result.includes('/gsd-new-project'));
    assert.ok(result.includes('/gsd-plan-phase'));
  });
});

// ─── convertClaudeToCopilotMarkdown ───────────────────────────────────────────

describe('convertClaudeToCopilotMarkdown', () => {
  test('applies slash command conversion', () => {
    const result = convertClaudeToCopilotMarkdown('Use /gsd:quick for ad-hoc tasks.');
    assert.ok(result.includes('/gsd-quick'));
  });

  test('replaces $ARGUMENTS with user prompt text', () => {
    const result = convertClaudeToCopilotMarkdown('Arguments: $ARGUMENTS');
    assert.ok(result.includes('user prompt text'));
    assert.ok(!result.includes('$ARGUMENTS'));
  });
});

// ─── convertClaudeCommandToCopilotSkill ───────────────────────────────────────

describe('convertClaudeCommandToCopilotSkill', () => {
  test('produces SKILL.md with name and description only', () => {
    const input = `---
name: gsd:help
description: Show available GSD commands
allowed-tools: [Read, Bash]
---

<objective>
Show help.
</objective>`;

    const result = convertClaudeCommandToCopilotSkill(input, 'gsd-help');

    assert.ok(result.startsWith('---\n'), 'starts with frontmatter');
    assert.ok(result.includes('name: "gsd-help"'), 'skill name in frontmatter');
    assert.ok(result.includes('description: "Show available GSD commands"'), 'description preserved');
    assert.ok(!result.includes('allowed-tools'), 'Claude-only fields removed');
    assert.ok(result.includes('<objective>'), 'body preserved');
    assert.ok(!result.includes('<codex_skill_adapter>'), 'no Codex adapter');
  });

  test('uses default description when missing', () => {
    const input = `---
name: gsd:foo
---

Body here.`;
    const result = convertClaudeCommandToCopilotSkill(input, 'gsd-foo');
    assert.ok(result.includes('Run GSD workflow gsd-foo'), 'default description');
  });
});

// ─── convertClaudeAgentToCopilotAgent ──────────────────────────────────────────

describe('convertClaudeAgentToCopilotAgent', () => {
  test('produces .agent.md style frontmatter with tools as YAML list', () => {
    const input = `---
name: gsd-executor
description: Executes GSD plans with atomic commits
tools: Read, Write, Edit, Bash, Grep, Glob
color: yellow
skills:
  - gsd-executor-workflow
---

<role>
You are a GSD plan executor.
</role>`;

    const result = convertClaudeAgentToCopilotAgent(input);

    assert.ok(result.startsWith('---\n'), 'starts with frontmatter');
    assert.ok(result.includes('name: "gsd-executor"'));
    assert.ok(result.includes('description: "Executes GSD plans with atomic commits"'));
    assert.ok(result.includes('tools:'), 'has tools');
    assert.ok(result.includes('- view'), 'Read -> view');
    assert.ok(result.includes('- edit'), 'Write/Edit -> edit');
    assert.ok(result.includes('- bash'), 'Bash -> bash');
    assert.ok(result.includes('- rg'), 'Grep -> rg');
    assert.ok(!result.includes('color:'), 'color removed');
    assert.ok(!result.includes('skills:'), 'skills removed');
    assert.ok(result.includes('<role>'), 'body preserved');
  });

  test('handles content without frontmatter', () => {
    const input = 'No frontmatter here.';
    const result = convertClaudeAgentToCopilotAgent(input);
    assert.strictEqual(result, input);
  });

  test('converts slash commands in body', () => {
    const input = `---
name: gsd-planner
description: Plans phases
tools: Read, Task
---

Run /gsd:execute-phase after planning.`;
    const result = convertClaudeAgentToCopilotAgent(input);
    assert.ok(result.includes('/gsd-execute-phase'));
    assert.ok(!result.includes('/gsd:execute-phase'));
  });
});

// ─── generateCopilotPluginJson ───────────────────────────────────────────────

describe('generateCopilotPluginJson', () => {
  test('produces valid JSON with required plugin fields', () => {
    const json = generateCopilotPluginJson(['gsd-help', 'gsd-new-project'], ['gsd-executor']);
    const data = JSON.parse(json);

    assert.strictEqual(data.name, 'get-shit-done');
    assert.ok(typeof data.description === 'string');
    assert.ok(data.version);
    assert.strictEqual(data.agents, 'agents/');
    assert.strictEqual(data.skills, 'skills/');
    assert.strictEqual(data.hooks, 'hooks.json');
  });

  test('works with empty skill/agent lists', () => {
    const json = generateCopilotPluginJson([], []);
    const data = JSON.parse(json);
    assert.strictEqual(data.name, 'get-shit-done');
  });
});

// ─── generateCopilotHooksJson ─────────────────────────────────────────────────

describe('generateCopilotHooksJson', () => {
  test('produces valid hooks config with sessionStart and postToolUse', () => {
    const targetDir = path.join(os.tmpdir(), 'gsd-copilot-test-' + Date.now());
    const json = generateCopilotHooksJson(targetDir, true);
    const data = JSON.parse(json);

    assert.strictEqual(data.version, 1);
    assert.ok(data.hooks);
    assert.ok(Array.isArray(data.hooks.sessionStart));
    assert.ok(Array.isArray(data.hooks.postToolUse));
    assert.ok(data.hooks.sessionStart[0].bash.includes('gsd-check-update'));
    assert.ok(data.hooks.postToolUse[0].bash.includes('gsd-context-monitor'));
  });

  test('uses targetDir in hook commands', () => {
    const targetDir = '/custom/.copilot';
    const json = generateCopilotHooksJson(targetDir, true);
    assert.ok(json.includes('/custom/.copilot'));
    assert.ok(json.includes('gsd-check-update.js'));
    assert.ok(json.includes('gsd-context-monitor.js'));
  });
});
