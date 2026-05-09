function randomMs(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
}

function setupLeaveRejoin(bot, createBot) {
    // Timers
    let jumpTimer = null
    let jumpOffTimer = null
    let watchdogTimer = null

    // State
    let stopped = false
    let lastLogAt = 0

    function logThrottled(msg, minGapMs = 2000) {
        const now = Date.now()
        if (now - lastLogAt >= minGapMs) {
            lastLogAt = now
            console.log(msg)
        }
    }

    function cleanup() {
        stopped = true

        if (jumpTimer) clearTimeout(jumpTimer)
        if (jumpOffTimer) clearTimeout(jumpOffTimer)
        if (watchdogTimer) clearInterval(watchdogTimer)

        jumpTimer = null
        jumpOffTimer = null
        watchdogTimer = null
    }

    function safeReconnect(reason = 'unknown') {
        if (stopped) return

        logThrottled(`[AFK] Reconnect requested (${reason})`)

        try {
            cleanup()

            if (bot) {
                try {
                    bot.removeAllListeners()
                } catch (e) {}

                try {
                    bot.end()
                } catch (e) {}
            }

            setTimeout(() => {
                try {
                    if (typeof createBot === 'function') {
                        createBot()
                    }
                } catch (e) {
                    console.log('[AFK] createBot error:', e?.message || e)
                }
            }, randomMs(3000, 7000))

        } catch (e) {
            console.log('[AFK] safeReconnect error:', e?.message || e)
        }
    }

    function scheduleNextJump() {
        if (stopped || !bot || !bot.entity) return

        try {
            bot.setControlState('jump', true)

            jumpOffTimer = setTimeout(() => {
                try {
                    if (bot) {
                        bot.setControlState('jump', false)
                    }
                } catch (e) {}
            }, 300)

        } catch (e) {
            console.log('[AFK] Jump error:', e?.message || e)
        }

        // Random jump every 30s -> 2m
        const nextJump = randomMs(30000, 120000)

        jumpTimer = setTimeout(() => {
            scheduleNextJump()
        }, nextJump)
    }

    bot.once('spawn', () => {
        stopped = false

        logThrottled('[AFK] Bot spawned successfully')

        scheduleNextJump()

        // Watchdog system
        watchdogTimer = setInterval(() => {
            try {
                if (
                    !bot ||
                    !bot._client ||
                    bot._client.ended ||
                    !bot.entity
                ) {
                    console.log('[AFK] Dead connection detected')
                    safeReconnect('watchdog')
                    return
                }

                // Keepalive activity
                if (bot._client && bot._client.socket) {
                    bot._client.socket.setKeepAlive(true, 30000)
                }

            } catch (e) {
                console.log('[AFK] Watchdog error:', e?.message || e)
            }
        }, 30000)
    })

    // Connection ended
    bot.on('end', () => {
        console.log('[AFK] Connection ended')
        cleanup()
    })

    // Kicked
    bot.on('kicked', (reason) => {
        console.log('[AFK] Kicked:', reason)
        cleanup()
    })

    // Errors
    bot.on('error', (err) => {
        console.log('[AFK] Error:', err?.message || err)
    })
}

module.exports = setupLeaveRejoin
