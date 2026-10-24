// Parse-check with Bun's transpiler for a clearer error position.
const src = await Bun.file('src/components/TeacherNotificationCenter.jsx').text()
const t = new Bun.Transpiler({ loader: 'jsx' })
try {
  t.transformSync(src)
  console.log('PARSE OK')
} catch (err) {
  console.log('PARSE FAIL:')
  console.log(String(err).slice(0, 1200))
}
