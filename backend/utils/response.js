function ok(data) {
  return { code: 0, data }
}

function fail(code, msg) {
  return { code: code || 400, msg: msg || 'error' }
}

module.exports = { ok, fail }
