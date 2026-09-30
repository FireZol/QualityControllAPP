'use strict';
// The application version (package.json is the single place it is written). A version with "-beta" shows a BETA tag.
const pkg = require('../package.json');

module.exports = { version: pkg.version, beta: /-beta/.test(pkg.version) };
