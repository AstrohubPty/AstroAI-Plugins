// Constellation: the agent map as a night sky. This script runs in a sandboxed frame: it gets a canvas context and a
// plain-data picture of the map each frame (g), draws, and that is all it can do: no network, no page, no storage.
//
// g: ctx, w, h, time, dt, reduced, flicker, cx, cy, R, colour [r,g,b], palette {accent, idle, running, dead, warn, danger, text, grey} (each [r,g,b]),
//    loops [{id, name, status, stages, builtin}], nodes [{id, x, y, r, angle}], sessions, runCount, field [{a, r, z, size, tw}],
//    bursts [{a, r, life, size}], running, energy, pulse, state, checks {id: {checking, waiting, scar, flow}}, focus.
astroai.style({
    draw: function (g) {
        var ctx = g.ctx
        var rgba = function (c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + Math.max(0, Math.min(1, a)) + ')' }
        var col = g.colour
        var TAU = Math.PI * 2

        // The sky: a faint wash round the core, and the stars of the ambient field.
        var wash = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.R * 2.2)
        wash.addColorStop(0, rgba(col, 0.1 * g.energy))
        wash.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = wash
        ctx.fillRect(0, 0, g.w, g.h)
        for (var i = 0; i < g.field.length; i++) {
            var p = g.field[i]
            var a = p.a + (g.reduced ? 0 : g.time * 0.01 * (1 + p.z))
            var x = g.cx + Math.cos(a) * p.r * g.R * 2.4
            var y = g.cy + Math.sin(a) * p.r * g.R * 2.0
            var twinkle = g.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(g.time * 1.3 + p.tw * 9)
            ctx.fillStyle = rgba(g.palette.text, (0.15 + 0.35 * twinkle) * g.flicker)
            ctx.beginPath()
            ctx.arc(x, y, Math.max(0.4, p.size * 0.8), 0, TAU)
            ctx.fill()
        }

        // Lines from each loop to the core: brighter while it works, red when it has been failing.
        for (var n = 0; n < g.nodes.length; n++) {
            var node = g.nodes[n]
            var loop = g.loops.filter(function (l) { return l.id === node.id })[0]
            var live = g.checks[node.id] || {}
            var failing = loop && loop.status === 'erroring'
            var faded = g.focus && g.focus !== node.id
            var lineCol = failing ? g.palette.danger : col
            var alpha = (loop && loop.status === 'active' ? 0.5 : loop && loop.status === 'disabled' ? 0.06 : 0.2) * (faded ? 0.3 : 1)
            ctx.strokeStyle = rgba(lineCol, alpha * g.flicker)
            ctx.lineWidth = 1 + (live.flow || 0) * 1.5
            ctx.beginPath()
            ctx.moveTo(g.cx, g.cy)
            ctx.lineTo(node.x, node.y)
            ctx.stroke()
            // A pulse travels along it while the loop is checking or active.
            if (!g.reduced && (live.checking || (loop && loop.status === 'active'))) {
                var t = (g.time * 0.5 + n * 0.37) % 1
                ctx.fillStyle = rgba(g.palette.text, 0.9)
                ctx.beginPath()
                ctx.arc(g.cx + (node.x - g.cx) * t, g.cy + (node.y - g.cy) * t, 2, 0, TAU)
                ctx.fill()
            }
        }

        // The stars: a glow, a bright point, and a small arc per stage.
        for (var m = 0; m < g.nodes.length; m++) {
            var s = g.nodes[m]
            var l = g.loops.filter(function (q) { return q.id === s.id })[0]
            if (!l) continue
            var info = g.checks[s.id] || {}
            var dim = g.focus && g.focus !== s.id ? 0.35 : 1
            var starCol = l.status === 'erroring' ? g.palette.danger : l.status === 'active' ? g.palette.running : l.status === 'disabled' || l.status === 'paused' ? g.palette.grey : g.palette.idle
            var glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 2.6)
            glow.addColorStop(0, rgba(starCol, 0.55 * dim))
            glow.addColorStop(1, rgba(starCol, 0))
            ctx.fillStyle = glow
            ctx.beginPath()
            ctx.arc(s.x, s.y, s.r * 2.6, 0, TAU)
            ctx.fill()
            ctx.fillStyle = rgba(g.palette.text, 0.95 * dim)
            ctx.beginPath()
            ctx.arc(s.x, s.y, Math.max(2, s.r * 0.32), 0, TAU)
            ctx.fill()
            var stages = Math.max(1, l.stages.length)
            var span = TAU / stages
            ctx.strokeStyle = rgba(starCol, 0.8 * dim)
            ctx.lineWidth = 1.4
            for (var k = 0; k < stages; k++) {
                var from = -Math.PI / 2 + k * span + 0.12
                ctx.beginPath()
                ctx.arc(s.x, s.y, s.r * 1.25, from, from + span - 0.24)
                ctx.stroke()
            }
            // Something waits on you: an amber ring that breathes.
            if (info.waiting) {
                ctx.strokeStyle = rgba(g.palette.warn, 0.55 + 0.4 * g.pulse)
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.arc(s.x, s.y, s.r * 1.7, 0, TAU)
                ctx.stroke()
            }
        }

        // The core: a bright star that pulses with the work.
        var cr = g.R * (0.16 + 0.03 * g.pulse)
        var core = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, cr * 3)
        core.addColorStop(0, rgba(g.palette.text, 0.95))
        core.addColorStop(0.25, rgba(col, 0.8 * g.flicker))
        core.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = core
        ctx.beginPath()
        ctx.arc(g.cx, g.cy, cr * 3, 0, TAU)
        ctx.fill()

        // A finished run: streaks flying into the core.
        for (var b = 0; b < g.bursts.length; b++) {
            var burst = g.bursts[b]
            var rr = burst.r * g.R
            ctx.strokeStyle = rgba(g.palette.text, Math.min(1, burst.life) * 0.8)
            ctx.lineWidth = burst.size
            ctx.beginPath()
            ctx.moveTo(g.cx + Math.cos(burst.a) * rr, g.cy + Math.sin(burst.a) * rr)
            ctx.lineTo(g.cx + Math.cos(burst.a) * (rr + 12), g.cy + Math.sin(burst.a) * (rr + 12))
            ctx.stroke()
        }
    },
})
