/**
 * ═══════════════════════════════════════════════════════════════════
 *  compat.js — طبقة التوافق الكاملة مع iOS Safari القديم
 * ═══════════════════════════════════════════════════════════════════
 *
 *  ده الجزء التاني من إصلاح "الصفحة البيضة على الآيفون":
 *  بناء الكود (vite target es2018) بيحل مشاكل "الصياغة"،
 *  والملف ده بيحل مشاكل "الـ APIs" — دوال حديثة ناقصة في
 *  Safari 12/13/14/15.
 *
 *  الملف ده لازم يفضل أول import في main.jsx — قبل أي كود تاني.
 *  كل تعريف محمي بـ typeof check عشان مايدخلش في تعارض مع المتصفحات
 *  الحديثة اللي بتوفر الـ API أصلاً.
 *
 *  (مبني على نفس مجموعة الـ polyfills اللي كانت في نسخة Round 9
 *  المنشورة + إضافات: ResizeObserver / BroadcastChannel /
 *  requestIdleCallback / TextEncoder guards.)
 */
/* eslint-disable no-extend-native */

// ─── globalThis (Safari 12.1+) ───
if (typeof globalThis === 'undefined') {
  window.globalThis = window
}

// ─── Object.hasOwn (Safari 15.4+) ───
if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = function (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }
}

// ─── Object.fromEntries (Safari 12.4+) ───
if (typeof Object.fromEntries !== 'function') {
  Object.fromEntries = function (entries) {
    const obj = {}
    for (const pair of entries) {
      if (pair && pair.length >= 2) obj[pair[0]] = pair[1]
    }
    return obj
  }
}

// ─── Promise.allSettled (Safari 13+) ───
if (typeof Promise.allSettled !== 'function') {
  Promise.allSettled = function (promises) {
    return Promise.all(Array.from(promises).map((p) => {
      try {
        return Promise.resolve(p).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        )
      } catch (err) {
        return Promise.resolve({ status: 'rejected', reason: err })
      }
    }))
  }
}

// ─── Promise.any + AggregateError (Safari 15+) ───
if (typeof Promise.any !== 'function') {
  if (typeof AggregateError !== 'function') {
    // eslint-disable-next-line no-inner-declarations
    function AggregateErrorShim(errors, message) {
      const err = new Error(message)
      err.name = 'AggregateError'
      err.errors = Array.from(errors)
      return err
    }
    window.AggregateError = AggregateErrorShim
  }
  Promise.any = function (promises) {
    return new Promise((resolve, reject) => {
      const items = Array.from(promises)
      const errors = []
      let pending = items.length
      if (pending === 0) {
        reject(new AggregateError([], 'All promises were rejected'))
        return
      }
      items.forEach((p, i) => {
        Promise.resolve(p).then(resolve, (err) => {
          errors[i] = err
          pending -= 1
          if (pending === 0) reject(new AggregateError(errors, 'All promises were rejected'))
        })
      })
    })
  }
}

// ─── Promise.prototype.finally (Safari 11.1+) ───
if (typeof Promise.prototype.finally !== 'function') {
  Promise.prototype.finally = function (callback) {
    return this.then(
      (value) => Promise.resolve(callback()).then(() => value),
      (reason) => Promise.resolve(callback()).then(() => { throw reason }),
    )
  }
}

// ─── queueMicrotask (Safari 12.1+) ───
if (typeof queueMicrotask !== 'function') {
  window.queueMicrotask = function (callback) {
    Promise.resolve(null).then(callback).catch((err) => {
      setTimeout(() => { throw err }, 0)
    })
  }
}

// ─── Array.prototype.at (Safari 15.4+) ───
if (typeof Array.prototype.at !== 'function') {
  Array.prototype.at = function (index) {
    const len = this.length
    let i = Math.trunc(index) || 0
    if (i < 0) i += len
    if (i < 0 || i >= len) return undefined
    return this[i]
  }
}

// ─── Array.prototype.findLast / findLastIndex (Safari 15.4+) ───
if (typeof Array.prototype.findLast !== 'function') {
  Array.prototype.findLast = function (predicate, thisArg) {
    for (let i = this.length - 1; i >= 0; i -= 1) {
      if (predicate.call(thisArg, this[i], i, this)) return this[i]
    }
    return undefined
  }
}
if (typeof Array.prototype.findLastIndex !== 'function') {
  Array.prototype.findLastIndex = function (predicate, thisArg) {
    for (let i = this.length - 1; i >= 0; i -= 1) {
      if (predicate.call(thisArg, this[i], i, this)) return i
    }
    return -1
  }
}

// ─── Array.prototype.flat / flatMap (Safari 12+) ───
if (typeof Array.prototype.flat !== 'function') {
  Array.prototype.flat = function (depth) {
    const d = depth === undefined ? 1 : Math.trunc(depth) || 0
    const flatten = (arr, level) => {
      const out = []
      for (const item of arr) {
        if (Array.isArray(item) && level > 0) out.push(...flatten(item, level - 1))
        else out.push(item)
      }
      return out
    }
    return flatten(this, d)
  }
}
if (typeof Array.prototype.flatMap !== 'function') {
  Array.prototype.flatMap = function (callback, thisArg) {
    return Array.prototype.flat.call(this.map(callback, thisArg), 1)
  }
}

// ─── String.prototype.at (Safari 15.4+) ───
if (typeof String.prototype.at !== 'function') {
  String.prototype.at = function (index) {
    const len = this.length
    let i = Math.trunc(index) || 0
    if (i < 0) i += len
    if (i < 0 || i >= len) return undefined
    return this.charAt(i)
  }
}

// ─── String.prototype.replaceAll (Safari 13.4+) ───
if (typeof String.prototype.replaceAll !== 'function') {
  String.prototype.replaceAll = function (search, replacement) {
    if (search instanceof RegExp) {
      if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp')
      return this.replace(search, replacement)
    }
    return this.split(search).join(replacement)
  }
}

// ─── String.prototype.matchAll (Safari 13+) ───
if (typeof String.prototype.matchAll !== 'function') {
  String.prototype.matchAll = function (regexp) {
    if (regexp && !regexp[Symbol.iterator]) {
      // eslint-disable-next-line no-param-reassign
      regexp = new RegExp(regexp.source, regexp.flags + (regexp.global ? '' : 'g'))
    }
    const self = this
    return {
      [Symbol.iterator]() {
        const re = new RegExp(regexp.source, (regexp.flags.includes('g') ? regexp.flags : regexp.flags + 'g'))
        let match
        let done = false
        return {
          next() {
            if (done) return { done: true, value: undefined }
            match = re.exec(self)
            if (match === null) { done = true; return { done: true, value: undefined } }
            if (re.lastIndex === match.index) re.lastIndex += 1
            return { done: false, value: match }
          },
        }
      },
    }
  }
}

// ─── String.prototype.trimStart / trimEnd (Safari 12+) ───
if (typeof String.prototype.trimStart !== 'function') {
  // eslint-disable-next-line no-extend-native
  String.prototype.trimStart = String.prototype.trimLeft || function () { return this.replace(/^\s+/, '') }
}
if (typeof String.prototype.trimEnd !== 'function') {
  String.prototype.trimEnd = String.prototype.trimRight || function () { return this.replace(/\s+$/, '') }
}

// ─── structuredClone (Safari 15.4+) ───
if (typeof structuredClone !== 'function') {
  window.structuredClone = function (value) {
    // JSON fallback يكفي لأن كل استخداماتنا لبيانات JSON-safe
    return JSON.parse(JSON.stringify(value))
  }
}

// ─── crypto.randomUUID (Safari 15.4+) — أشهر سبب crash مع Supabase ───
try {
  if (!window.crypto) window.crypto = {}
  if (window.crypto && typeof window.crypto.randomUUID !== 'function') {
    window.crypto.randomUUID = function () {
      if (typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16)
        window.crypto.getRandomValues(bytes)
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        const hex = []
        for (let i = 0; i < 16; i += 1) hex.push(('0' + bytes[i].toString(16)).slice(-2))
        return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
          hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('')
      }
      // fallback أخير (context غير آمن)
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    }
  }
  if (window.crypto && typeof window.crypto.getRandomValues !== 'function') {
    window.crypto.getRandomValues = function (array) {
      for (let i = 0; i < array.length; i += 1) array[i] = Math.floor(Math.random() * 256)
      return array
    }
  }
} catch (cryptoErr) {
  console.warn('[compat] crypto polyfill skipped:', cryptoErr)
}

// ─── ResizeObserver (Safari 13.1+) — Chart.js والمكتبات محتاجاه ───
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback }
    observe(target) {
      // استدعاء واحد فورًا بس عشان المخططات ترسم مرة واحدة
      try {
        this.callback([{ target, contentRect: { width: target.clientWidth || 300, height: target.clientHeight || 200, top: 0, left: 0, right: 0, bottom: 0 } }], this)
      } catch (err) { /* silent */ }
    }
    unobserve() {}
    disconnect() {}
  }
}

// ─── IntersectionObserver (Safari 12.2+) ───
if (typeof window.IntersectionObserver === 'undefined') {
  window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback }
    observe(target) {
      try { this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }], this) } catch (err) { /* silent */ }
    }
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
}

// ─── requestIdleCallback (غير مدعوم في Safari قبل 18؟ — fallback آمن) ───
if (typeof window.requestIdleCallback !== 'function') {
  window.requestIdleCallback = function (callback) {
    return setTimeout(() => {
      const start = Date.now()
      callback({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (Date.now() - start)) })
    }, 1)
  }
}
if (typeof window.cancelIdleCallback !== 'function') {
  window.cancelIdleCallback = function (id) { clearTimeout(id) }
}

// ─── BroadcastChannel (Safari 15.4+) — Supabase Realtime cross-tab ───
// fallback صامت بدون بث (القناة الرئيسية بتشتغل عبر WebSocket في كل الحالات)
if (typeof window.BroadcastChannel === 'undefined') {
  window.BroadcastChannel = class {
    constructor() { this.onmessage = null; this.onmessageerror = null }
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return false }
  }
}

// ─── TextEncoder / TextDecoder (Safari 10.3+ — للأمان فقط) ───
try {
  if (typeof window.TextEncoder === 'undefined') {
    window.TextEncoder = class {
      encode(str) {
        const out = []
        for (let i = 0; i < str.length; i += 1) {
          let code = str.charCodeAt(i)
          if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
            const next = str.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
              code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000
              i += 1
            }
          }
          if (code < 0x80) out.push(code)
          else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
          else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
          else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
        }
        return new Uint8Array(out)
      }
    }
  }
} catch (teErr) { /* silent */ }

export const COMPAT_VERSION = 'round10-final'
