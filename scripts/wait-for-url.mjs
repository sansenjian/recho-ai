const [, , url = 'http://127.0.0.1:3000/health', timeoutMsArg = '30000'] = process.argv

const timeoutMs = Number(timeoutMsArg)
const deadline = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 30000)
let lastError = null

while (Date.now() < deadline) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (res.ok) process.exit(0)
    lastError = new Error(`${res.status} ${res.statusText}`)
  } catch (err) {
    lastError = err
  } finally {
    clearTimeout(timer)
  }

  await new Promise(resolve => setTimeout(resolve, 500))
}

const detail = lastError instanceof Error ? ` (${lastError.message})` : ''
console.error(`Timed out waiting for ${url}${detail}`)
process.exit(1)
