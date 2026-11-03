      /* iOS 13–16 compatibility shims — MUST run before the app modules.
         The bundle is transpiled to es2019 (see vite.config.js) so old
         iPhones can parse it; these tiny polyfills cover newer runtime
         APIs that some dependencies call directly. Classic inline script
         = executes immediately, before any deferred module script. */
      (function () {
        function at(n) {
          n = Math.trunc(n) || 0
          if (n < 0) n += this.length
          if (n < 0 || n >= this.length) return undefined
          return this[n]
        }
        function define(obj, name, value) {
          if (!obj[name]) Object.defineProperty(obj, name, { value: value, writable: true, configurable: true })
        }
        define(Array.prototype, 'at', at)
        define(String.prototype, 'at', at)
        define(Object, 'hasOwn', function (o, p) { return Object.prototype.hasOwnProperty.call(o, p) })
        define(String.prototype, 'replaceAll', function (search, replacement) {
          if (search instanceof RegExp) {
            if (!search.global) throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument')
            return this.replace(search, replacement)
          }
          return this.split(search).join(replacement)
        })
        define(Array.prototype, 'findLast', function (cb, thisArg) {
          for (var i = this.length - 1; i >= 0; i--) if (cb.call(thisArg, this[i], i, this)) return this[i]
          return undefined
        })
        define(Array.prototype, 'findLastIndex', function (cb, thisArg) {
          for (var i = this.length - 1; i >= 0; i--) if (cb.call(thisArg, this[i], i, this)) return i
          return -1
        })
        define(Promise, 'withResolvers', function () {
          var resolve, reject
          var promise = new this(function (res, rej) { resolve = res; reject = rej })
          return { promise: promise, resolve: resolve, reject: reject }
        })
      })()
