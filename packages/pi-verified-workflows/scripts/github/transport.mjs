import { pathToFileURL } from 'node:url';

import { createFixtureTransport } from './transport-fixture.mjs';
import { createGhTransport } from './transport-gh.mjs';

export async function loadTransport(environment = process.env) {
  if (environment.PI_GITHUB_TRANSPORT === 'fixture') {
    return createFixtureTransport(environment);
  }

  if (environment.PI_GITHUB_TRANSPORT_MODULE) {
    const moduleUrl = pathToFileURL(environment.PI_GITHUB_TRANSPORT_MODULE).href;
    const loadedModule = await import(moduleUrl);
    if (typeof loadedModule.createTransport !== 'function') {
      throw new Error('Custom transport module must export createTransport(environment).');
    }
    return loadedModule.createTransport(environment);
  }

  return createGhTransport();
}
