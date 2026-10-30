import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const REQUIRED_SHARED_TOOLCHAIN = [
  {
    name: 'svelte',
    reason: 'Compile original .svelte and .svx components and provide the SSR render runtime.',
  },
  {
    name: 'mdsvex',
    reason: 'Preprocess original .svx documents into Svelte before compilation.',
  },
  {
    name: 'vite',
    reason: 'Resolve the real module graph and transform TypeScript, JSON imports, and import.meta.glob.',
  },
  {
    name: '@sveltejs/vite-plugin-svelte',
    reason: 'Bridge Svelte compilation into the Vite pipeline used for source-backed rendering.',
  },
];

const BLOCKED_SPEC_FIELDS = [
  'html',
  'renderedHtml',
  'markup',
  'inlineHtml',
  'inlineSource',
  'sourceText',
  'componentSource',
];

const SUPPORTED_ENTRY_EXTENSIONS = new Set(['.svx', '.svelte']);

export class GuardrailStop extends Error {
  constructor(code, summary, details = {}) {
    super(summary);
    this.name = 'GuardrailStop';
    this.code = code;
    this.exitCode = 2;
    this.details = details;
  }
}

export function projectRootFromMeta(metaUrl) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), '..', '..');
}

export function createHelp(operation) {
  const usage =
    operation === 'source-preview:render'
      ? 'node ./scripts/source-preview/render.mjs --spec <preview-spec.json>'
      : 'node ./scripts/source-preview/check.mjs --spec <preview-spec.json>';

  return {
    ok: true,
    operation,
    summary: `Help for ${operation}`,
    artifacts: [],
    warnings: [],
    help: {
      usage,
      options: {
        '--help': 'Show this JSON help payload.',
        '--spec <file>': 'Path to a JSON preview spec. Relative paths resolve from the current working directory.',
      },
      notes: [
        'Stdout is always JSON.',
        'Diagnostics are written to stderr.',
        'Only trusted reviewed-local source is supported.',
        'Spec fields resolve from the spec file directory, except entry/layout/alias paths which resolve from sourceRoot.',
        'This lane does not claim sandboxing and refuses inline or remote source inputs.',
      ],
    },
  };
}

export function parseArgs(argv, operation) {
  let specPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help') {
      return { help: true, specPath: null };
    }

    if (arg === '--spec') {
      specPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new GuardrailStop(
      'validation_failed',
      `Unsupported argument for ${operation}: ${arg}`,
      { argument: arg },
    );
  }

  if (!specPath) {
    throw new GuardrailStop(
      'validation_failed',
      `Missing required --spec argument for ${operation}.`,
    );
  }

  return { help: false, specPath };
}

export async function loadAndValidateSpec(specPathArg, metaUrl) {
  const projectRoot = projectRootFromMeta(metaUrl);
  const specPath = path.resolve(process.cwd(), specPathArg);

  let specText;
  try {
    specText = await fs.readFile(specPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new GuardrailStop('validation_failed', 'Preview spec file was not found.', { specPath });
    }
    throw error;
  }

  let spec;
  try {
    spec = JSON.parse(specText);
  } catch (error) {
    throw new GuardrailStop('validation_failed', 'Preview spec must contain valid JSON.', {
      specPath,
      parseError: error instanceof Error ? error.message : String(error),
    });
  }

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new GuardrailStop('validation_failed', 'Preview spec must be a JSON object.');
  }

  for (const field of BLOCKED_SPEC_FIELDS) {
    if (Object.hasOwn(spec, field)) {
      throw new GuardrailStop(
        'unsupported',
        `Preview spec field ${field} is not supported. source-preview only accepts reviewed local files and refuses inline rendered substitutes.`,
        { field },
      );
    }
  }

  const specDir = path.dirname(specPath);
  const trust = validateTrust(spec.trust);
  const sourceRoot = await resolveExistingDirectory(specDir, spec.sourceRoot, 'sourceRoot');
  const sourceRootRealPath = await fs.realpath(sourceRoot);
  const entryPath = await resolveExistingFile(sourceRootRealPath, spec.entry, 'entry');
  const entryRealPath = await fs.realpath(entryPath);
  ensureWithinRoot(sourceRootRealPath, entryRealPath, 'entry');

  const entryExtension = path.extname(entryRealPath);
  if (!SUPPORTED_ENTRY_EXTENSIONS.has(entryExtension)) {
    throw new GuardrailStop(
      'unsupported',
      `Unsupported entry file extension ${entryExtension || '(none)'}. source-preview only supports .svx and .svelte entries.`,
      { entry: entryRealPath },
    );
  }

  const aliases = await validateAliases(spec.aliases, sourceRootRealPath);
  const frontmatter = await readFrontmatter(entryRealPath);
  const layouts = await validateLayouts(spec.layouts, sourceRootRealPath, frontmatter.layout);
  const render = validateRenderSpec(spec.render, specDir);
  const toolchain = await inspectSharedToolchain(projectRoot);
  const anchorDigests = await buildAnchorDigests({ specPath, entryRealPath, layouts });
  const warnings = [];

  if (!toolchain.ready) {
    warnings.push(
      `Render toolchain not ready from the root package manifest: ${toolchain.missing.join(', ')}.`,
    );
  }

  if (!render.clock?.freezeAt) {
    warnings.push('render.clock.freezeAt is not set; future real renders should pin time for deterministic evidence.');
  }

  return {
    projectRoot,
    specPath,
    spec,
    trust,
    sourceRootRealPath,
    entryRealPath,
    frontmatter,
    aliases,
    layouts,
    render,
    toolchain,
    anchorDigests,
    warnings,
  };
}

function validateTrust(trust) {
  if (!trust || typeof trust !== 'object' || Array.isArray(trust)) {
    throw new GuardrailStop(
      'unsupported',
      'Preview spec must declare trust.mode="reviewed-local" and trust.reviewed=true.',
    );
  }

  if (trust.mode !== 'reviewed-local' || trust.reviewed !== true) {
    throw new GuardrailStop(
      'unsupported',
      'source-preview only supports trusted reviewed-local source. Refusing unreviewed, remote, or ambiguous inputs.',
      { trust },
    );
  }

  return {
    mode: trust.mode,
    reviewed: true,
    reviewedBy: typeof trust.reviewedBy === 'string' ? trust.reviewedBy : null,
    reviewedAt: typeof trust.reviewedAt === 'string' ? trust.reviewedAt : null,
  };
}

async function validateAliases(aliases, sourceRootRealPath) {
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    throw new GuardrailStop('validation_failed', 'Preview spec must include an aliases object.');
  }

  if (typeof aliases['#lib'] !== 'string' || aliases['#lib'].trim() === '') {
    throw new GuardrailStop(
      'validation_failed',
      'Preview spec must include aliases["#lib"] for source-backed imports.',
    );
  }

  const resolved = {};

  for (const [alias, aliasPath] of Object.entries(aliases)) {
    if (typeof aliasPath !== 'string' || aliasPath.trim() === '') {
      throw new GuardrailStop('validation_failed', `Alias ${alias} must be a non-empty string path.`);
    }
    const resolvedPath = await resolveExistingDirectory(sourceRootRealPath, aliasPath, `aliases.${alias}`);
    const resolvedRealPath = await fs.realpath(resolvedPath);
    ensureWithinRoot(sourceRootRealPath, resolvedRealPath, `aliases.${alias}`);
    resolved[alias] = resolvedRealPath;
  }

  return resolved;
}

async function validateLayouts(layouts, sourceRootRealPath, requiredLayoutName) {
  if (!requiredLayoutName) {
    return {};
  }

  if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) {
    throw new GuardrailStop(
      'validation_failed',
      `Entry frontmatter declares layout ${requiredLayoutName}, but spec.layouts is missing.`,
    );
  }

  if (typeof layouts[requiredLayoutName] !== 'string' || layouts[requiredLayoutName].trim() === '') {
    throw new GuardrailStop(
      'validation_failed',
      `Entry frontmatter declares layout ${requiredLayoutName}, but spec.layouts.${requiredLayoutName} is missing.`,
    );
  }

  const resolved = {};
  for (const [layoutName, layoutPath] of Object.entries(layouts)) {
    if (typeof layoutPath !== 'string' || layoutPath.trim() === '') {
      throw new GuardrailStop('validation_failed', `Layout ${layoutName} must be a non-empty string path.`);
    }
    const resolvedPath = await resolveExistingFile(sourceRootRealPath, layoutPath, `layouts.${layoutName}`);
    const resolvedRealPath = await fs.realpath(resolvedPath);
    ensureWithinRoot(sourceRootRealPath, resolvedRealPath, `layouts.${layoutName}`);
    resolved[layoutName] = resolvedRealPath;
  }

  return resolved;
}

function validateRenderSpec(render, specDir) {
  const value = render && typeof render === 'object' && !Array.isArray(render) ? render : {};

  if (
    value.browserInspection !== undefined
    && value.browserInspection !== 'existing-browser'
  ) {
    throw new GuardrailStop(
      'unsupported',
      'render.browserInspection must be "existing-browser" when provided.',
      { browserInspection: value.browserInspection },
    );
  }

  const artifactBaseName = sanitizeArtifactBaseName(value.artifactBaseName ?? 'source-preview');
  const artifactDir = path.resolve(specDir, value.artifactDir ?? './artifacts/source-preview');

  return {
    artifactBaseName,
    artifactDir,
    browserInspection: 'existing-browser',
    clock:
      value.clock && typeof value.clock === 'object' && !Array.isArray(value.clock)
        ? {
            freezeAt: typeof value.clock.freezeAt === 'string' ? value.clock.freezeAt : null,
            timezone: typeof value.clock.timezone === 'string' ? value.clock.timezone : 'UTC',
            locale: typeof value.clock.locale === 'string' ? value.clock.locale : 'en-US',
          }
        : { freezeAt: null, timezone: 'UTC', locale: 'en-US' },
  };
}

function sanitizeArtifactBaseName(input) {
  const normalized = String(input).trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'source-preview';
}

async function resolveExistingDirectory(baseDir, candidate, field) {
  const resolvedPath = resolveLocalPath(baseDir, candidate, field);
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new GuardrailStop('validation_failed', `${field} must point to an existing directory.`, {
        field,
        path: resolvedPath,
      });
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new GuardrailStop('validation_failed', `${field} must point to an existing directory.`, {
      field,
      path: resolvedPath,
    });
  }
  return resolvedPath;
}

async function resolveExistingFile(baseDir, candidate, field) {
  const resolvedPath = resolveLocalPath(baseDir, candidate, field);
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new GuardrailStop('validation_failed', `${field} must point to an existing file.`, {
        field,
        path: resolvedPath,
      });
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new GuardrailStop('validation_failed', `${field} must point to an existing file.`, {
      field,
      path: resolvedPath,
    });
  }
  return resolvedPath;
}

function resolveLocalPath(baseDir, candidate, field) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new GuardrailStop('validation_failed', `${field} must be a non-empty string path.`);
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    throw new GuardrailStop(
      'unsupported',
      `${field} must be a local filesystem path. Remote URLs are unsupported.`,
      { field, value: candidate },
    );
  }

  return path.resolve(baseDir, candidate);
}

function ensureWithinRoot(rootRealPath, candidateRealPath, field) {
  const relative = path.relative(rootRealPath, candidateRealPath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return;
  }

  throw new GuardrailStop(
    'unsupported',
    `${field} resolves outside sourceRoot. Refusing traversal or alias escapes.`,
    { field, candidate: candidateRealPath, sourceRoot: rootRealPath },
  );
}

async function readFrontmatter(entryRealPath) {
  if (path.extname(entryRealPath) !== '.svx') {
    return { format: 'svelte', fields: {}, layout: null };
  }

  const text = await fs.readFile(entryRealPath, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match) {
    return { format: 'svx', fields: {}, layout: null };
  }

  const fields = {};
  for (const line of match[1].split(/\r?\n/u)) {
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    value = value.replace(/^['"]/, '').replace(/['"]$/, '');
    fields[key] = value;
  }

  return {
    format: 'svx',
    fields,
    layout: typeof fields.layout === 'string' && fields.layout !== '' ? fields.layout : null,
  };
}

async function inspectSharedToolchain(projectRoot) {
  const packageManifestPath = path.join(projectRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageManifestPath, 'utf8'));
  const declaredDependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  };
  const requireFromProject = createRequire(packageManifestPath);

  const packages = REQUIRED_SHARED_TOOLCHAIN.map((tool) => {
    let resolvedPackageJson = null;
    try {
      resolvedPackageJson = requireFromProject.resolve(`${tool.name}/package.json`);
    } catch {
      resolvedPackageJson = null;
    }

    return {
      name: tool.name,
      reason: tool.reason,
      declaredInRootManifest: Object.hasOwn(declaredDependencies, tool.name),
      installedFromRootManifest: Boolean(resolvedPackageJson),
      packageJsonPath: resolvedPackageJson,
    };
  });

  const missing = packages
    .filter((pkg) => !pkg.declaredInRootManifest || !pkg.installedFromRootManifest)
    .map((pkg) => pkg.name);

  return {
    packageManifestPath,
    reviewedSharedReady: missing.length === 0,
    ready: missing.length === 0,
    missing,
    packages,
  };
}

async function buildAnchorDigests({ specPath, entryRealPath, layouts }) {
  const files = [
    { kind: 'spec', path: specPath },
    { kind: 'entry', path: entryRealPath },
    ...Object.entries(layouts).map(([layoutName, layoutPath]) => ({
      kind: 'layout',
      layoutName,
      path: layoutPath,
    })),
  ];

  return Promise.all(
    files.map(async (file) => ({
      ...file,
      digest: await sha256File(file.path),
    })),
  );
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  return `sha256:${digest}`;
}

export function buildCheckPayload(validation) {
  return {
    ok: true,
    operation: 'source-preview:check',
    summary: `Validated reviewed-local preview spec for ${path.relative(validation.projectRoot, validation.entryRealPath)}`,
    artifacts: [],
    warnings: validation.warnings,
    trust: validation.trust,
    source: {
      sourceRoot: validation.sourceRootRealPath,
      entry: validation.entryRealPath,
      frontmatter: validation.frontmatter,
      aliases: validation.aliases,
      layouts: validation.layouts,
      anchorDigests: validation.anchorDigests,
    },
    renderPlan: buildRenderPlan(validation),
    toolchain: validation.toolchain,
  };
}

export function buildRenderPayload(validation) {
  const renderPlan = buildRenderPlan(validation);
  const missingToolchain = !validation.toolchain.ready;
  const reason = missingToolchain
    ? 'missing_reviewed_shared_toolchain'
    : 'adapter_execution_disabled';
  const summary = missingToolchain
    ? 'Refused to render because the reviewed shared source-preview toolchain is not available from the root package manifest, and this lane will not fabricate HTML.'
    : 'Refused to render because this guardrail-first lane build only emits validated render plans and provenance; it does not fabricate or substitute rendered output.';

  return {
    ok: false,
    operation: 'source-preview:render',
    code: 'unsupported',
    summary,
    artifacts: renderPlan.artifacts,
    warnings: validation.warnings,
    render: {
      status: 'refused',
      reason,
      preservesOriginalSourcePath: true,
      substituteHtmlForbidden: true,
      provenance: {
        trust: validation.trust,
        sourceRoot: validation.sourceRootRealPath,
        entry: validation.entryRealPath,
        frontmatter: validation.frontmatter,
        aliases: validation.aliases,
        layouts: validation.layouts,
        anchorDigests: validation.anchorDigests,
        requestedSharedDependencies: REQUIRED_SHARED_TOOLCHAIN,
        toolchain: validation.toolchain,
        browserInspection: renderPlan.browserInspection,
        adapterContract: renderPlan.adapterContract,
      },
    },
  };
}

export function buildRenderPlan(validation) {
  const { artifactDir, artifactBaseName, browserInspection, clock } = validation.render;
  return {
    artifactDirectory: artifactDir,
    browserInspection,
    clock,
    adapterContract: {
      adapter: 'vite+svelte+mdsvex',
      sandboxing: 'not-claimed',
      executionSource: 'original reviewed-local source only',
      handwrittenHtmlFallback: 'forbidden',
      substituteComputationPresentedAsRender: 'forbidden',
    },
    artifacts: [
      {
        kind: 'rendered-html',
        role: 'browser-input',
        status: 'planned',
        path: path.join(artifactDir, `${artifactBaseName}.html`),
      },
      {
        kind: 'render-metadata',
        role: 'provenance',
        status: 'planned',
        path: path.join(artifactDir, `${artifactBaseName}.render.json`),
      },
      {
        kind: 'browser-observation',
        role: 'browser-output',
        status: 'planned',
        path: path.join(artifactDir, `${artifactBaseName}.browser.json`),
      },
    ],
  };
}

export function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function writeDiagnostic(message) {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
}

export function formatErrorPayload(operation, error) {
  if (error instanceof GuardrailStop) {
    return {
      exitCode: error.exitCode,
      payload: {
        ok: false,
        operation,
        code: error.code,
        summary: error.message,
        artifacts: [],
        warnings: [],
        details: error.details,
      },
      diagnostic: `${operation}: ${error.message}`,
    };
  }

  return {
    exitCode: 1,
    payload: {
      ok: false,
      operation,
      code: 'internal_error',
      summary: error instanceof Error ? error.message : 'Unexpected internal error.',
      artifacts: [],
      warnings: [],
    },
    diagnostic: `${operation}: unexpected internal error`,
  };
}
