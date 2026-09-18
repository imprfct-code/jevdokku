import { readFile, readdir } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

const { VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID } = process.env
if (!VERCEL_TOKEN || !VERCEL_ORG_ID || !VERCEL_PROJECT_ID) {
  throw new Error('Missing Vercel deployment credentials.')
}

async function api(path, body) {
  const response = await fetch(`https://api.vercel.com${path}?teamId=${VERCEL_ORG_ID}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(`Vercel ${response.status}: ${result.error?.message ?? 'Request failed'}`)
  }
  return result
}

const paths = await readdir('dist', { recursive: true, withFileTypes: true })
const files = await Promise.all(
  paths
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const path = `${entry.parentPath}/${entry.name}`
      return {
        file: path.slice('dist/'.length),
        data: (await readFile(path)).toString('base64'),
        encoding: 'base64',
      }
    }),
)
const { rewrites } = JSON.parse(await readFile('vercel.json', 'utf8'))
const settings = { framework: null, buildCommand: '', installCommand: '', outputDirectory: '.' }
files.push({
  file: 'vercel.json',
  data: JSON.stringify({ ...settings, rewrites }),
  encoding: 'utf-8',
})

// The CLI's team lookup rejects project-scoped tokens: vercel/vercel#17506.
const deployment = await api('/v13/deployments', {
  name: 'jevdokku',
  project: VERCEL_PROJECT_ID,
  target: 'production',
  files,
  projectSettings: settings,
  meta: {
    githubCommitSha: process.env.GITHUB_SHA ?? '',
    githubCommitRef: process.env.GITHUB_REF_NAME ?? '',
  },
})
console.log(`Deployment: https://${deployment.url}`)
const deadline = Date.now() + 10 * 60_000
while (true) {
  const status = await api(`/v13/deployments/${deployment.id}`)
  if (status.readyState === 'READY') break
  if (['ERROR', 'CANCELED'].includes(status.readyState)) {
    throw new Error(`Deployment ${status.readyState}: ${status.errorMessage ?? deployment.id}`)
  }
  if (Date.now() > deadline) throw new Error(`Deployment timed out: ${deployment.id}`)
  console.log(`Vercel: ${status.readyState}`)
  await setTimeout(5000)
}
await api(`/v2/deployments/${deployment.id}/aliases`, { alias: 'jev.imprfct.dev' })
console.log('Published https://jev.imprfct.dev')
