import {
  buildCheckPayload,
  createHelp,
  formatErrorPayload,
  loadAndValidateSpec,
  parseArgs,
  writeDiagnostic,
  writeJson,
} from './lib.mjs';

const operation = 'source-preview:check';

try {
  const args = parseArgs(process.argv.slice(2), operation);

  if (args.help) {
    writeJson(createHelp(operation));
    process.exit(0);
  }

  const validation = await loadAndValidateSpec(args.specPath, import.meta.url);
  const payload = buildCheckPayload(validation);

  if (payload.warnings.length > 0) {
    writeDiagnostic(`${operation}: ${payload.warnings.join(' ')}`);
  } else {
    writeDiagnostic(`${operation}: validated ${payload.source.entry}`);
  }

  writeJson(payload);
  process.exit(0);
} catch (error) {
  const failure = formatErrorPayload(operation, error);
  writeDiagnostic(failure.diagnostic);
  writeJson(failure.payload);
  process.exit(failure.exitCode);
}
