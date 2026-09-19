#!/usr/bin/env node
/* Capture full stack of the pageerror during demo boot. */
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => { console.log('PAGEERROR STACK:\n' + (e.stack || String(e))) })
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE: ' + m.text().slice(0, 500)) })
await page.goto(`${BASE}/?auth=login`, { waitUntil: 'load' })
await page.fill('input[type="email"]', 'perf@nokhba.test')
await page.fill('input[type="password"]', 'perf1234')
await page.locator('button[type="submit"]').first().click()
await page.waitForTimeout(5000)
await browser.close()
