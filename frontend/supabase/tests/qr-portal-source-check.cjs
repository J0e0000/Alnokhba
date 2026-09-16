const fs = require('fs')
const source = fs.readFileSync('src/pages/PublicQRPage.jsx', 'utf8')
for (const value of ['get_student_portal_data', 'registerStudentPush', '/qr/']) {
  if (!source.includes(value)) throw new Error(`missing ${value}`)
}
console.log('QR_PORTAL_SOURCE_CHECK_OK')
