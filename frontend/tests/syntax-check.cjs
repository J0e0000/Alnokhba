// Use @babel/parser to syntax-check JSX/JS files
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')

const files = [
  'src/pages/PublicQRPage.jsx',
  'src/pages/ParentPortal.jsx',
  'src/pages/Dashboard.jsx',
  'src/pages/AdminDashboard.jsx',
  'src/context/AuthContext.jsx',
  'src/components/ExamsListModal.jsx',
  'src/components/ExamModal.jsx',
  'src/components/AnalyticsModal.jsx',
  'src/components/SessionHistoryModal.jsx',
  'src/components/SettingsModal.jsx',
  'src/components/InteractiveTutorial.jsx',
  'src/components/QRDiagnosticPanel.jsx',
  'src/components/SendQrButton.jsx',
  'src/components/AdminBackupsPanel.jsx',
  'src/components/AdminTeamsPanel.jsx',
  'src/components/AdminAuditLogsPanel.jsx',
  'src/components/AdminSupportAccessModal.jsx',
  'src/components/SupportAccessBanner.jsx',
  'src/components/WhatsAppHandoffBar.jsx',
  'src/components/MessageQueueModal.jsx',
  'src/components/AnnouncementsModal.jsx',
  'src/lib/translations.js',
  'src/lib/helpers.js',
  'src/lib/portalRealtime.js',
  'src/App.jsx',
  'src/lib/qrPdfWhatsApp.js',
  'src/lib/undoManager.js',
  'src/lib/offlineQueue.js',
]

let allOk = true
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  try {
    parser.parse(src, {
      sourceType: 'module',
      plugins: ['jsx'],
    })
    console.log('  OK    ' + f)
  } catch (e) {
    allOk = false
    console.log('  FAIL  ' + f + '  —  ' + e.message.split('\n')[0])
  }
}
process.exit(allOk ? 0 : 1)
