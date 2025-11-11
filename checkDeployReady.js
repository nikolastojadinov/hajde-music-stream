import fs from 'fs'
const files = ['render.yaml', 'netlify.toml', '.env.production']
const missing = files.filter(f => !fs.existsSync(f))
if (missing.length) {
  console.error('❌ Missing deploy files:', missing)
  process.exit(1)
}
console.log('✅ All deploy files found and ready.')
process.exit(0)
