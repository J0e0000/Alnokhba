/**
 * legacyPolyfills.js — Round 9 ("blank page on iPhone" permanent fix)
 * ------------------------------------------------------------------
 * WHY: the bundler now transpiles SYNTAX (?. ?? ??=) down to ES2019 so any
 * iPhone from iOS 12 can PARSE the app, but a handful of built-in METHODS
 * that modern code relies on cannot be transpiled — they must be defined at
 * runtime. On iOS < 15.4 a single call like `list.at(-1)` or
 * `Object.hasOwn(obj, key)` throws a TypeError and can crash the whole
 * render tree → blank page.
 *
 * This file is imported FIRST in main.jsx (before React and the app) and
 * installs safe, spec-aligned fallbacks for every such method the app and
 * its dependencies use.
 *
 * RULES for this file:
 *   - ES5 syntax ONLY (no arrow functions, no let/const, no template
 *     literals, no optional chaining) so the file itself is parseable by
 *     the same old browsers it protects.
 *   - Never overwrite a native implementation that already exists.
 */

/* ------------------------------------------------------------------ */
/* globalThis (Safari < 12.1)                                          */
/* ------------------------------------------------------------------ */
if (typeof globalThis === 'undefined') {
  (function () {
    var g
    try {
      g = self // eslint-disable-line no-restricted-globals
    } catch (e) {
      g = window
    }
    if (g) {
      Object.defineProperty(Object.prototype, '__nokhbaGlobalThis__', {
        get: function () { return g },
        configurable: true,
        enumerable: false,
      })
      g.globalThis = g
      delete Object.prototype.__nokhbaGlobalThis__
    }
  })()
}

/* ------------------------------------------------------------------ */
/* Object.hasOwn (Safari < 15.4) — used by some libraries             */
/* ------------------------------------------------------------------ */
if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = function (obj, key) {
    return obj != null && Object.prototype.hasOwnProperty.call(obj, key)
  }
}

/* ------------------------------------------------------------------ */
/* Object.fromEntries (Safari < 12.1)                                  */
/* ------------------------------------------------------------------ */
if (typeof Object.fromEntries !== 'function') {
  Object.fromEntries = function (entries) {
    var out = {}
    if (entries == null) return out
    for (var i = 0; i < entries.length; i++) {
      var pair = entries[i]
      if (pair && pair.length >= 2) out[pair[0]] = pair[1]
    }
    return out
  }
}

/* ------------------------------------------------------------------ */
/* Array.prototype.at / String.prototype.at (Safari < 15.4)            */
/* ------------------------------------------------------------------ */
function nokhbaAt(index) {
  var len = this.length >>> 0
  var i = Math.trunc(index) || 0
  if (i < 0) i += len
  if (i < 0 || i >= len) return undefined
  return this[i]
}
if (typeof Array.prototype.at !== 'function') {
  try { Object.defineProperty(Array.prototype, 'at', { value: nokhbaAt, writable: true, configurable: true }) } catch (e) { Array.prototype.at = nokhbaAt }
}
if (typeof String.prototype.at !== 'function') {
  try { Object.defineProperty(String.prototype, 'at', { value: nokhbaAt, writable: true, configurable: true }) } catch (e) { String.prototype.at = nokhbaAt }
}

/* ------------------------------------------------------------------ */
/* Array.prototype.findLast / findLastIndex (Safari < 15.4)            */
/* ------------------------------------------------------------------ */
if (typeof Array.prototype.findLast !== 'function') {
  Array.prototype.findLast = function (predicate, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) {
      if (predicate.call(thisArg, this[i], i, this)) return this[i]
    }
    return undefined
  }
}
if (typeof Array.prototype.findLastIndex !== 'function') {
  Array.prototype.findLastIndex = function (predicate, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) {
      if (predicate.call(thisArg, this[i], i, this)) return i
    }
    return -1
  }
}

/* ------------------------------------------------------------------ */
/* Array.prototype.flat / flatMap (Safari < 12)                        */
/* ------------------------------------------------------------------ */
if (typeof Array.prototype.flat !== 'function') {
  Array.prototype.flat = function (depth) {
    var d = depth === undefined ? 1 : Math.trunc(depth) || 0
    var out = []
    var push = function (arr, level) {
      for (var i = 0; i < arr.length; i++) {
        if (Array.isArray(arr[i]) && level < d) push(arr[i], level + 1)
        else out.push(arr[i])
      }
    }
    push(this, 0)
    return out
  }
}
if (typeof Array.prototype.flatMap !== 'function') {
  Array.prototype.flatMap = function (fn, thisArg) {
    var mapped = []
    for (var i = 0; i < this.length; i++) mapped.push(fn.call(thisArg, this[i], i, this))
    var out = []
    for (var j = 0; j < mapped.length; j++) {
      if (Array.isArray(mapped[j])) {
        for (var k = 0; k < mapped[j].length; k++) out.push(mapped[j][k])
      } else out.push(mapped[j])
    }
    return out
  }
}

/* ------------------------------------------------------------------ */
/* String.prototype.replaceAll (Safari < 13.4)                         */
/* ------------------------------------------------------------------ */
if (typeof String.prototype.replaceAll !== 'function') {
  String.prototype.replaceAll = function (search, replacement) {
    if (search instanceof RegExp) {
      if (search.global) return this.replace(search, replacement)
      throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument')
    }
    if (replacement === undefined) replacement = ''
    var s = String(this)
    var srch = String(search)
    if (srch === '') {
      // Matches spec: "ab".replaceAll("", "-") === "-a-b-"
      var parts = ['']
      for (var i = 0; i < s.length; i++) parts.push(s.charAt(i))
      parts.push('')
      return parts.join(String(replacement))
    }
    return s.split(srch).join(String(replacement))
  }
}

/* ------------------------------------------------------------------ */
/* String.prototype.matchAll (Safari < 13)                             */
/* ------------------------------------------------------------------ */
if (typeof String.prototype.matchAll !== 'function') {
  String.prototype.matchAll = function (regexp) {
    if (!(regexp instanceof RegExp)) {
      throw new TypeError('String.prototype.matchAll requires a global RegExp')
    }
    var self = this
    var iterator = {
      next: function () {
        var m = regexp.exec(self)
        return { value: m, done: m === null }
      }
    }
    // Make it usable with for..of on engines that support iteration protocol
    if (typeof Symbol !== 'undefined' && Symbol.iterator) {
      try { iterator[Symbol.iterator] = function () { return iterator } } catch (e) { /* ignore */ }
    }
    return iterator
  }
}

/* ------------------------------------------------------------------ */
/* String.trimStart / trimEnd (Safari < 12)                            */
/* ------------------------------------------------------------------ */
if (typeof String.prototype.trimStart !== 'function') {
  String.prototype.trimStart = function () { return String(this).replace(/^\s+/, '') }
}
if (typeof String.prototype.trimEnd !== 'function') {
  String.prototype.trimEnd = function () { return String(this).replace(/\s+$/, '') }
}

/* ------------------------------------------------------------------ */
/* Promise.any + AggregateError (Safari < 14)                          */
/* ------------------------------------------------------------------ */
if (typeof Promise.any !== 'function') {
  if (typeof AggregateError !== 'function') {
    // Minimal AggregateError (subclass of Error) — good enough for fallback
    function AggregateError(errors, message) {
      var err = new Error(message || '')
      err.name = 'AggregateError'
      err.errors = Array.prototype.slice.call(errors || [])
      Object.setPrototypeOf(err, AggregateError.prototype)
      return err
    }
    AggregateError.prototype = Object.create(Error.prototype)
    AggregateError.prototype.constructor = AggregateError
    AggregateError.prototype.name = 'AggregateError'
    // expose on globalThis safely
    (typeof globalThis !== 'undefined' ? globalThis : window).AggregateError = AggregateError
  }
  Promise.any = function (iterable) {
    var items = Array.from(iterable)
    return new Promise(function (resolve, reject) {
      if (items.length === 0) {
        reject(new AggregateError([], 'All promises were rejected'))
        return
      }
      var pending = items.length
      var errors = new Array(items.length)
      items.forEach(function (p, idx) {
        Promise.resolve(p).then(resolve, function (err) {
          errors[idx] = err
          pending -= 1
          if (pending === 0) reject(new AggregateError(errors, 'All promises were rejected'))
        })
      })
    })
  }
}

/* ------------------------------------------------------------------ */
/* Promise.allSettled (Safari < 13)                                    */
/* ------------------------------------------------------------------ */
if (typeof Promise.allSettled !== 'function') {
  Promise.allSettled = function (iterable) {
    var items = Array.from(iterable)
    return Promise.all(items.map(function (p) {
      return Promise.resolve(p).then(
        function (value) { return { status: 'fulfilled', value: value } },
        function (reason) { return { status: 'rejected', reason: reason } }
      )
    }))
  }
}

/* ------------------------------------------------------------------ */
/* structuredClone (Safari < 15.4) — JSON-safe fallback                */
/* Covers plain objects/arrays/strings/numbers/booleans/null — which    */
/* is all the app ever clones. NOT a full structured-clone (no Maps,    */
/* Sets, Dates, cycles) but a safe, non-throwing stand-in.              */
/* ------------------------------------------------------------------ */
if (typeof structuredClone !== 'function') {
  (typeof globalThis !== 'undefined' ? globalThis : window).structuredClone = function (value) {
    if (value === undefined) return undefined
    try {
      return JSON.parse(JSON.stringify(value))
    } catch (e) {
      // Cycles / unsupported types — throw like the real one would
      throw new DOMException('structuredClone fallback: value is not cloneable', 'DataCloneError')
    }
  }
}

/* ------------------------------------------------------------------ */
/* crypto.randomUUID (Safari < 15.4)                                   */
/* ------------------------------------------------------------------ */
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : window
  if (!g.crypto) g.crypto = {}
  if (g.crypto && typeof g.crypto.randomUUID !== 'function') {
    // Only possible in secure contexts with getRandomValues available
    if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
      try {
        Object.defineProperty(g.crypto, 'randomUUID', {
          value: function () {
            var bytes = new Uint8Array(16)
            g.crypto.getRandomValues(bytes)
            // Set version 4 + variant bits, then format
            bytes[6] = (bytes[6] & 0x0f) | 0x40
            bytes[8] = (bytes[8] & 0x3f) | 0x80
            var hex = []
            for (var i = 0; i < 16; i++) hex.push((bytes[i] + 0x100).toString(16).slice(1))
            return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
              hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
              hex.slice(10, 16).join('')
          },
          writable: true,
          configurable: true
        })
      } catch (e) { /* non-configurable in some engines — ignore */ }
    }
  }
})()

/* ------------------------------------------------------------------ */
/* End of polyfills — main.jsx imports this file BEFORE React           */
/* ------------------------------------------------------------------ */
