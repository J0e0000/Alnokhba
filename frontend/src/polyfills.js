/**
 * Runtime polyfills for older Safari / iOS (12 – 15.3) and older Android
 * browsers. Round 12 fix for the "white blank page on iPhone" issue.
 *
 * The production bundle is now transpiled to ES2018 (syntax), but some
 * LIBRARIES still CALL modern runtime APIs that older Safari lacks.
 * Every polyfill below is guarded (only installed when missing) and
 * dependency-free, so it is a no-op on modern browsers.
 *
 * This file MUST be the first import in src/main.jsx.
 */

/* ------------------------------------------------------------------ */
/* Array.prototype.at — Safari 15.4+ (used by pdf.js / chart code)      */
/* ------------------------------------------------------------------ */
if (typeof Array.prototype.at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', {
    value: function at(n) {
      n = Math.trunc(n) || 0
      if (n < 0) n += this.length
      if (n < 0 || n >= this.length) return undefined
      return this[n]
    },
    writable: true, configurable: true, enumerable: false,
  })
}

/* String.prototype.at — Safari 15.4+ */
if (typeof String.prototype.at !== 'function') {
  Object.defineProperty(String.prototype, 'at', {
    value: function at(n) {
      n = Math.trunc(n) || 0
      if (n < 0) n += this.length
      if (n < 0 || n >= this.length) return undefined
      return this[n]
    },
    writable: true, configurable: true, enumerable: false,
  })
}

/* ------------------------------------------------------------------ */
/* String.prototype.replaceAll — Safari 13.1+                          */
/* ------------------------------------------------------------------ */
if (typeof String.prototype.replaceAll !== 'function') {
  Object.defineProperty(String.prototype, 'replaceAll', {
    value: function replaceAll(search, replacement) {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('String.replaceAll called with a non-global RegExp argument')
        return this.replace(search, replacement)
      }
      if (replacement === undefined) replacement = ''
      var s = String(this)
      var searchStr = String(search)
      if (searchStr === '') return s.replace(/(?:)/g, String(replacement))
      var escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return s.replace(new RegExp(escaped, 'g'), String(replacement))
    },
    writable: true, configurable: true, enumerable: false,
  })
}

/* ------------------------------------------------------------------ */
/* Object.hasOwn — Safari 15.4+                                        */
/* ------------------------------------------------------------------ */
if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = function hasOwn(obj, prop) {
    if (obj === null || obj === undefined) throw new TypeError('Cannot convert undefined or null to object')
    return Object.prototype.hasOwnProperty.call(Object(obj), prop)
  }
}

/* ------------------------------------------------------------------ */
/* Array.prototype.findLast / findLastIndex — Safari 15.4+             */
/* ------------------------------------------------------------------ */
if (typeof Array.prototype.findLast !== 'function') {
  Object.defineProperty(Array.prototype, 'findLast', {
    value: function findLast(cb, thisArg) {
      for (var i = this.length - 1; i >= 0; i--) {
        if (cb.call(thisArg, this[i], i, this)) return this[i]
      }
      return undefined
    },
    writable: true, configurable: true, enumerable: false,
  })
}
if (typeof Array.prototype.findLastIndex !== 'function') {
  Object.defineProperty(Array.prototype, 'findLastIndex', {
    value: function findLastIndex(cb, thisArg) {
      for (var i = this.length - 1; i >= 0; i--) {
        if (cb.call(thisArg, this[i], i, this)) return i
      }
      return -1
    },
    writable: true, configurable: true, enumerable: false,
  })
}

/* ------------------------------------------------------------------ */
/* Array.prototype.flat / flatMap — Safari 12+                         */
/* ------------------------------------------------------------------ */
if (typeof Array.prototype.flat !== 'function') {
  Object.defineProperty(Array.prototype, 'flat', {
    value: function flat(depth) {
      depth = depth === undefined ? 1 : Math.trunc(depth) || 0
      var out = []
      var step = function (arr, d) {
        for (var i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i]) && d > 0) step(arr[i], d - 1)
          else out.push(arr[i])
        }
      }
      step(this, depth)
      return out
    },
    writable: true, configurable: true, enumerable: false,
  })
}
if (typeof Array.prototype.flatMap !== 'function') {
  Object.defineProperty(Array.prototype, 'flatMap', {
    value: function flatMap(cb, thisArg) {
      var out = []
      for (var i = 0; i < this.length; i++) {
        var v = cb.call(thisArg, this[i], i, this)
        if (Array.isArray(v)) out.push.apply(out, v)
        else out.push(v)
      }
      return out
    },
    writable: true, configurable: true, enumerable: false,
  })
}

/* ------------------------------------------------------------------ */
/* Object.fromEntries — Safari 12.1+                                   */
/* ------------------------------------------------------------------ */
if (typeof Object.fromEntries !== 'function') {
  Object.fromEntries = function fromEntries(iterable) {
    var obj = {}
    var it = iterable[Symbol.iterator] ? iterable[Symbol.iterator]() : iterable
    var entry
    while ((entry = it.next ? it.next() : null) && !entry.done) {
      var pair = entry.value
      obj[String(pair[0])] = pair[1]
    }
    return obj
  }
}

/* ------------------------------------------------------------------ */
/* Promise.any — Safari 15+                                            */
/* ------------------------------------------------------------------ */
if (typeof Promise.any !== 'function') {
  Promise.any = function any(promises) {
    return new Promise(function (resolve, reject) {
      var items = Array.from(promises)
      var errors = []
      var pending = items.length
      if (pending === 0) {
        reject(new AggregateError ? new AggregateError([], 'All promises were rejected') : new Error('All promises were rejected'))
        return
      }
      items.forEach(function (p, i) {
        Promise.resolve(p).then(resolve, function (err) {
          errors[i] = err
          if (--pending === 0) {
            reject(new AggregateError ? new AggregateError(errors, 'All promises were rejected') : new Error('All promises were rejected'))
          }
        })
      })
    })
  }
}

/* ------------------------------------------------------------------ */
/* structuredClone — Safari 15.4+ (JSON fallback is enough for our      */
/* plain-object usage; fails on functions/DOM/Map — guarded)            */
/* ------------------------------------------------------------------ */
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = function structuredClone(value) {
    if (value === undefined || typeof value === 'function') return value
    return JSON.parse(JSON.stringify(value))
  }
}

/* ------------------------------------------------------------------ */
/* crypto.randomUUID — Safari 15.4+ (secure contexts)                   */
/* ------------------------------------------------------------------ */
try {
  if (typeof globalThis.crypto !== 'object' || globalThis.crypto === null) {
    globalThis.crypto = {}
  }
  if (typeof globalThis.crypto.randomUUID !== 'function') {
    var __hex = '0123456789abcdef'
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: function randomUUID() {
        var bytes = new Uint8Array(16)
        if (globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes)
        else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        var s = ''
        for (var j = 0; j < 16; j++) {
          if (j === 4 || j === 6 || j === 8 || j === 10) s += '-'
          s += __hex[bytes[j] >> 4] + __hex[bytes[j] & 0xf]
        }
        return s
      },
      writable: true, configurable: true,
    })
  }
} catch (polyfillCryptoError) {
  /* some browsers lock `crypto` — app code must tolerate missing randomUUID */
}

/* ------------------------------------------------------------------ */
/* BroadcastChannel safety — supabase-js guards it, but be defensive:   */
/* if the constructor exists but throws (old private-mode Safari),      */
/* neutralize it so storage sync falls back silently.                   */
/* ------------------------------------------------------------------ */
try {
  if (typeof globalThis.BroadcastChannel === 'function') {
    var __bcTest = new globalThis.BroadcastChannel('__nokhba_probe__')
    __bcTest.close()
  }
} catch (probeError) {
  try { Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true }) } catch (ignore) {}
}

/* ------------------------------------------------------------------ */
/* Mark polyfills as loaded (used by the index.html watchdog report)    */
/* ------------------------------------------------------------------ */
globalThis.__NOKHBA_POLYFILLS__ = true
