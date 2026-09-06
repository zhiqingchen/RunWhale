const assert = require('node:assert/strict')
process.exitCode = 1

// Exercise the timer -> async continuation -> interpreter path from the crash.
setTimeout(async () => {
  await Promise.resolve()
  let depth = 0
  function recurse() {
    if (++depth === 50_000) throw new Error('V8 did not enforce its stack limit')
    return recurse() + 1
  }
  try {
    assert.throws(recurse, RangeError)
    assert.ok(depth > 0 && depth < 50_000)
    setTimeout(() => {
      console.log('PASS: caught stack overflow; Node remains responsive')
      process.exitCode = 0
    }, 0)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}, 10)
