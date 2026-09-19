import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDeployment } from '@vercel/client'

const { VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID } = process.env
if (!VERCEL_TOKEN || !VERCEL_ORG_ID || !VERCEL_PROJECT_ID) {
  throw new Error('Missing Vercel deployment credentials.')
}
const domain = 'jev.imprfct.dev'
async function api(path, body) {
  const response = await fetch(`https://api.vercel.com${path}?teamId=${VERCEL_ORG_ID}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(`Vercel ${response.status}: ${result.error?.message ?? 'Request failed'}`)
  return result
}

// Upload Build Output API files directly; no remote build queue or CLI team lookup.
const output = resolve('.vercel/output')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp('dist', `${output}/static`, { recursive: true })
const config = JSON.parse(await readFile('vercel.json', 'utf8'))
const apiDestination = config.rewrites.find((rule) => rule.source === '/api/:path*').destination
await writeFile(
  `${output}/config.json`,
  JSON.stringify({
    version: 3,
    routes: [
      { src: '^/api/(.*)$', dest: apiDestination.replace(':path*', '$1') },
      { handle: 'filesystem' },
    ],
  }),
)
const previous = await api(`/v4/aliases/${domain}`)
let deployment
for await (const event of createDeployment(
  {
    token: VERCEL_TOKEN,
    teamId: VERCEL_ORG_ID,
    path: process.cwd(),
    prebuilt: true,
    vercelOutputDir: output,
  },
  {
    name: 'jevdokku',
    project: VERCEL_PROJECT_ID,
    target: 'production',
    autoAssignCustomDomains: false,
    meta: {
      githubCommitSha: process.env.GITHUB_SHA ?? '',
      githubCommitRef: process.env.GITHUB_REF_NAME ?? '',
    },
  },
)) {
  if (event.type === 'error') throw new Error(event.payload.message)
  if (event.type === 'created') console.log(`Deployment: https://${event.payload.url}`)
  if (event.type === 'ready') {
    deployment = event.payload
    break
  }
}
if (!deployment) throw new Error('Vercel did not return a ready deployment.')
await api(`/v2/deployments/${deployment.id}/aliases`, { alias: domain })
try {
  const response = await fetch(`https://${domain}/`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok || !(await response.text()).includes('<div id="root">'))
    throw new Error('Homepage check failed.')
  for (const path of ['config', 'stats']) {
    const response = await fetch(`https://${domain}/api/${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`API ${path}: ${response.status}`)
    const data = await response.json()
    if (path === 'config' ? data.hasKey !== true : typeof data.requests !== 'number')
      throw new Error(`Invalid API ${path} response.`)
  }
} catch (error) {
  const previousId = previous.deploymentId ?? previous.deployment?.id
  if (previousId) await api(`/v2/deployments/${previousId}/aliases`, { alias: domain })
  throw error
}
console.log(`Published and verified https://${domain}`)
