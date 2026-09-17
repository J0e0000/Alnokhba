import assert from 'node:assert/strict'
import { isValidPhone } from '../src/lib/helpers.js'

assert.equal(isValidPhone('01014999663'), true)
assert.equal(isValidPhone('201014999663'), true)
assert.equal(isValidPhone('010149996636'), false)
assert.equal(isValidPhone('01012'), false)
assert.equal(isValidPhone('1234567890'), false)
console.log('PHONE_VALIDATION_OK')
