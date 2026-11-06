'use client'

/**
 * Browser startup marks, visible in the Performance panel as `alibai:*` and logged once as a
 * single line of milliseconds. Timings only. To remove, delete this file and its `marks` calls.
 *
 * In order: sdk-import, mic, connect-response (POST /connect returned, once the agent exists; the
 * server logs Agora's own start call as agora-start), player-joined, mic-published, then for each
 * remote {agent,avatar}: -joined (user-joined), -published-{audio,video} (user-published),
 * -decoded-{audio,video} (first decoded frame), then ready-request and ready (the server started
 * the clock).
 */
export function startupMarks() {
  const began = performance.now()
  const marks: Record<string, number> = {}
  return {
    mark(name: string) {
      if (name in marks) return
      marks[name] = Math.round(performance.now() - began)
      performance.mark(`alibai:${name}`)
    },
    report(outcome: 'ready' | 'failed') { console.info(`[timing] startup ${outcome} ${JSON.stringify(marks)}`) },
  }
}
