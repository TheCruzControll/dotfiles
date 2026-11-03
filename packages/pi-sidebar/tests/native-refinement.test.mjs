// Run the shared suite against the installed 1.5 runtime without installing anything.
process.env.PI_SIDEBAR_TEST_RELEASE = '1.5.0';
await import('./sidebar.test.mjs');
