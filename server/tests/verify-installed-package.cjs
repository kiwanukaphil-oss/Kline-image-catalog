const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPosDependencies } = require('../pos-dependencies.cjs');

/** Verify the installed release artifact against source without opening a database connection. */
function verifyInstalledPackage() {
  const { posRequire } = loadPosDependencies();
  const installed = path.dirname(posRequire.resolve('@kline/pos-workspace'));
  const source = path.resolve(__dirname, '..');
  const expected = [
    'README.md',
    'index.cjs',
    'package.json',
    'pos-dependencies.cjs',
    'workspace-repository.cjs',
    'workspace-router.cjs',
    'workspace-service.cjs',
  ];
  assert.deepEqual(fs.readdirSync(installed).sort(), expected);
  for (const file of expected) {
    assert.equal(
      fs.readFileSync(path.join(installed, file), 'utf8').replace(/\r\n/g, '\n'),
      fs.readFileSync(path.join(source, file), 'utf8').replace(/\r\n/g, '\n'),
      `Installed ${file} differs from source. Rebuild and reinstall the package.`,
    );
  }
  const version = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'))).version;
  console.log(
    `Installed @kline/pos-workspace@${version}: all seven files match source; no fixtures shipped.`,
  );
}

verifyInstalledPackage();
