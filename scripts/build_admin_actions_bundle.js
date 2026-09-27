// Build a dashboard-deploy bundle for the updated admin-account-actions edge
// function (same format as send_push_edge_deploy_v3.json): inlines index.ts.
// Usage: bun scripts/build_admin_actions_bundle.js
import { writeFileSync } from 'node:fs'

const content = await Bun.file('supabase/functions/admin-account-actions/index.ts').text()
const bundle = {
  project_id: 'pbsythpzncjoafpmijyd',
  name: 'admin-account-actions',
  entrypoint_path: 'index.ts',
  verify_jwt: true,
  files: [{ name: 'index.ts', content }],
}
writeFileSync('supabase/admin_account_actions_deploy_renewal.json', JSON.stringify(bundle))
console.log('bundle written:', 'supabase/admin_account_actions_deploy_renewal.json', `(${bundle.files[0].content.length} bytes)`)
