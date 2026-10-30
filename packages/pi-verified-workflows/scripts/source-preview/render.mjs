import {
  buildRenderPayload,
  createHelp,
  formatErrorPayload,
  loadAndValidateSpec,
  parseArgs,
  writeDiagnostic,
  writeJson,
} from './lib.mjs';

const operation = 'source-preview:render';

try {
  const args = parseArgs(process.argv.slice(2), operation);

  if (args.help) {
    writeJson(createHelp(operation));
    process.exit(0);
  }

  const validation = await loadAndValidateSpec(args.specPath, import.meta.url);
  const payload = buildRenderPayload(validation);

  writeDiagnostic(`${operation}: ${payload.summary}`);
  writeJson(payload);
  process.exit(2);
} catch (error) {
  const failure = formatErrorPayload(operation, error);
  writeDiagnostic(failure.diagnostic);
  writeJson(failure.payload);
  process.exit(failure.exitCode);
}
