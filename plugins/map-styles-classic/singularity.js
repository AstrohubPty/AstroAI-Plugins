// singularity: one of AstroAI's classic agent-map styles. Plain JavaScript that runs in a sandboxed frame: it gets a canvas and a
// plain-data picture of the map each frame and draws (see the Constellation style for the shape of what it is given).
(function() {

// web/src/lib/.port/adapt.ts
	const motion = {
		ringAngle: /* @__PURE__ */ new Map(),
		ringSpeed: /* @__PURE__ */ new Map(),
		nodeAngle: /* @__PURE__ */ new Map()
	};
	function adapt(g, draw) {
		const byId = new Map(g.loops.map((loop) => [loop.id, loop]));
		const nodes = g.nodes.map((node) => ({
			loop: byId.get(node.id),
			x: node.x,
			y: node.y,
			r: node.r,
			angle: node.angle
		}));
		const at = (id) => g.checks[id] ?? {};
		const checks = {
			isChecking: (id) => Boolean(at(id).checking),
			lastCheck: (id) => at(id).last ?? void 0,
			waiting: (id) => at(id).waiting ?? 0,
			scar: (id) => at(id).scar ?? 0,
			flow: (id) => at(id).flow ?? 0,
			focus: g.focus
		};
		const hits = draw({
			ctx: g.ctx,
			palette: g.palette,
			col: g.colour,
			time: g.time,
			dt: g.dt,
			reduced: g.reduced,
			flicker: g.flicker,
			cx: g.cx,
			cy: g.cy,
			R: g.R,
			w: g.w,
			h: g.h
		}, {
			loops: g.loops,
			nodes,
			sessions: g.sessions,
			runCount: g.runCount,
			field: g.field,
			bursts: g.bursts,
			motion,
			checks,
			running: g.running,
			energy: g.energy,
			pulse: g.pulse,
			state: g.state
		});
		return {
			rings: (hits?.rings ?? []).map((ring) => ({
				r: ring.r,
				loop: ring.loop.id
			})),
			satellites: (hits?.satellites ?? []).map((sat) => ({
				x: sat.x,
				y: sat.y,
				session: sat.session.id
			}))
		};
	}

// web/src/lib/orb-draw.ts
	const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;
	const mix = (a, b, t) => [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t
	];
	/** Where a loop's waiting beacon sits: a badge at its node's upper right, clear of the labels round it (its button goes there too). */
	const beaconAt = (node) => ({
		x: node.x + node.r * 1.2,
		y: node.y - node.r * 1.2
	});
	const HOLO_LOOK = {
		shape: "orb",
		link: "dash",
		stages: "arc"
	};
	/** The points of a node's link, node to sphere: straight, a curve (bending alternately) or a circuit trace. */
	function linkPoints(look, x1, y1, x0, y0, index, env, live) {
		if (look.link === "wave") {
			const dx = x0 - x1;
			const dy = y0 - y1;
			const len = Math.hypot(dx, dy) || 1;
			const amp = (live ? 5 : 1.6) * (env.reduced ? .5 : 1);
			return Array.from({ length: 41 }, (_, i) => {
				const t = i / 40;
				const off = Math.sin(t * Math.PI * 2 * 5 - (env.reduced ? 0 : env.time * (live ? 9 : 3)) + index) * amp * Math.sin(Math.PI * t);
				return [x1 + dx * t - dy / len * off, y1 + dy * t + dx / len * off];
			});
		}
		if (look.link === "spiral") {
			const { cx, cy } = env;
			const r1 = Math.hypot(x1 - cx, y1 - cy);
			const r0 = Math.hypot(x0 - cx, y0 - cy);
			const a1 = Math.atan2(y1 - cy, x1 - cx);
			return Array.from({ length: 31 }, (_, i) => {
				const t = i / 30;
				const r = r1 + (r0 - r1) * t;
				const a = a1 + 1.1 * t * t;
				return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
			});
		}
		if (look.link === "curve") {
			const dx = x0 - x1;
			const dy = y0 - y1;
			const len = Math.hypot(dx, dy) || 1;
			const bend = len * .3 * (index % 2 ? 1 : -1);
			const qx = (x0 + x1) / 2 - dy / len * bend;
			const qy = (y0 + y1) / 2 + dx / len * bend;
			return Array.from({ length: 21 }, (_, i) => {
				const t = i / 20;
				return [(1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * qx + t * t * x0, (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * qy + t * t * y0];
			});
		}
		if (look.link === "trace") {
			const dx = x0 - x1;
			const dy = y0 - y1;
			const bendAt = Math.abs(dx) > Math.abs(dy) ? [x0 - Math.sign(dx) * Math.abs(dy), y1] : [x1, y0 - Math.sign(dy) * Math.abs(dx)];
			return [
				[x1, y1],
				bendAt,
				[x0, y0]
			];
		}
		return [[x1, y1], [x0, y0]];
	}
	/** The point `t` (0 to 1) of the way along a polyline. */
	function along(points, t) {
		const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
		let left = t * lengths.reduce((sum, len) => sum + len, 0);
		for (let i = 0; i < lengths.length; i++) {
			if (left <= lengths[i] || i === lengths.length - 1) {
				const k = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
				return [points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k];
			}
			left -= lengths[i];
		}
		return points.at(-1);
	}
	const hexPath = (ctx, x, y, r) => {
		ctx.beginPath();
		for (let i = 0; i < 6; i++) {
			const a = Math.PI / 3 * i;
			if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
			else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
		}
		ctx.closePath();
	};
	/** The live agent map: each loop's node, its link to the sphere, its stages and sessions, and its sync. Returns the session satellites (for hover). */
	function drawNodes(env, nodes, allSessions, motion, checks, look = HOLO_LOOK) {
		const { ctx, palette, time, dt, reduced, flicker, cx, cy, R } = env;
		const { nodeAngle } = motion;
		const satellites = [];
		const SR0 = R * .9;
		for (const [index, node] of nodes.entries()) {
			const { loop, x, y, r } = node;
			ctx.save();
			if (checks.focus && checks.focus !== loop.id) ctx.globalAlpha = .2;
			const flow = Math.max(0, Math.min(1, checks.flow?.(loop.id) ?? 0));
			const lit = look.lit ? Math.max(0, Math.min(1, look.lit(node))) : 0;
			const sessions = allSessions.filter((session) => session.loop === loop.id);
			const blocked = sessions.some((session) => session.status === "blocked");
			const base = loop.status === "erroring" ? palette.danger : loop.status === "active" || sessions.length ? palette.running : palette.idle;
			const off = loop.status === "paused" || loop.status === "disabled";
			const nc = off ? palette.grey : blocked ? palette.warn : base;
			const alpha = (loop.status === "disabled" ? .35 : loop.status === "paused" ? .55 : 1) * flicker;
			const live = sessions.length > 0;
			const dx = x - cx;
			const dy = y - cy;
			const dist = Math.hypot(dx, dy);
			const ux = dx / dist;
			const uy = dy / dist;
			const x0 = cx + ux * SR0;
			const y0 = cy + uy * SR0;
			const x1 = x - ux * r * 1.9;
			const y1 = y - uy * r * 1.9;
			const path = linkPoints(look, x1, y1, x0, y0, index, env, live);
			if (look.link !== "none") {
				ctx.save();
				ctx.strokeStyle = rgba(nc, (live ? .55 : look.link === "dash" ? .22 : .16) * alpha + lit * .3);
				ctx.lineWidth = live ? 1.4 + 3.2 * flow : 1;
				if (look.link === "dash") {
					ctx.setLineDash(live ? [2, 6] : [1, 5]);
					ctx.lineDashOffset = reduced || !live ? 0 : time * 26;
				}
				const broken = loop.status === "erroring";
				ctx.beginPath();
				if (broken) {
					ctx.strokeStyle = rgba(palette.danger, .6 * alpha);
					for (const [from, to] of [[0, .4], [.6, 1]]) for (let k = 0; k <= 12; k++) {
						const [px, py] = along(path, from + (to - from) * k / 12);
						if (k === 0) ctx.moveTo(px, py);
						else ctx.lineTo(px, py);
					}
				} else path.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
				ctx.stroke();
				if (broken) {
					const [ax, ay] = along(path, .4);
					const [bx, by] = along(path, .6);
					ctx.setLineDash([]);
					ctx.fillStyle = rgba(palette.danger, .9 * alpha);
					for (const [ex, ey] of [[ax, ay], [bx, by]]) {
						ctx.beginPath();
						ctx.arc(ex, ey, 2, 0, Math.PI * 2);
						ctx.fill();
					}
					if (!reduced && Math.sin(time * 13 + index * 5) > .55) {
						ctx.strokeStyle = rgba(mix(palette.danger, [
							255,
							255,
							255
						], .5), .9 * alpha);
						ctx.lineWidth = 1.2;
						ctx.shadowColor = rgba(palette.danger, 1);
						ctx.shadowBlur = 10;
						ctx.beginPath();
						ctx.moveTo(ax, ay);
						const jag = 4 * Math.sin(time * 40);
						ctx.lineTo((ax + bx) / 2 + jag, (ay + by) / 2 - jag);
						ctx.lineTo(bx, by);
						ctx.stroke();
					}
				}
				if (look.link === "trace") {
					ctx.fillStyle = rgba(nc, (live ? .8 : .4) * alpha);
					for (const [px, py] of path) ctx.fillRect(px - 2, py - 2, 4, 4);
				}
				if (live && !reduced && !broken) {
					ctx.setLineDash([]);
					const count = 3 + Math.round(flow * 4);
					for (let k = 0; k < count; k++) {
						const t = (time * .45 * (1 + 1.6 * flow) + k / count) % 1;
						const [px, py] = along(path, t);
						ctx.fillStyle = rgba(mix(nc, palette.text, .4), .9 * Math.sin(Math.PI * t));
						ctx.shadowColor = rgba(nc, 1);
						ctx.shadowBlur = 8;
						ctx.beginPath();
						ctx.arc(px, py, 1.8 + 1.4 * flow, 0, Math.PI * 2);
						ctx.fill();
					}
				}
				ctx.restore();
			}
			ctx.save();
			const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
			glow.addColorStop(0, rgba(nc, (live ? .38 : look.shape === "contact" ? .08 : .2) * alpha + lit * .35));
			glow.addColorStop(1, rgba(nc, 0));
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(x, y, r * 3, 0, Math.PI * 2);
			ctx.fill();
			const breathe = reduced ? 0 : (live ? .08 : .03) * Math.sin(time * (live ? 3 : 1.2) + node.angle);
			if (look.shape !== "orb") {
				ctx.restore();
				drawShape(env, look.shape, x, y, r * (1 + breathe), nc, alpha, live, lit, loop.builtin, loop.status === "disabled");
			} else {
				const body = ctx.createRadialGradient(x - r * .3, y - r * .35, r * .1, x, y, r * (1 + breathe));
				if (loop.status === "disabled") {
					body.addColorStop(0, rgba(nc, .06));
					body.addColorStop(1, rgba(nc, .12));
				} else {
					body.addColorStop(0, rgba(mix(nc, [
						255,
						255,
						255
					], .75), .95 * alpha));
					body.addColorStop(.45, rgba(nc, .75 * alpha));
					body.addColorStop(1, rgba(mix(nc, [
						0,
						0,
						0
					], .55), .85 * alpha));
				}
				ctx.fillStyle = body;
				ctx.beginPath();
				if (loop.builtin) {
					const d = r * (1 + breathe) * 1.12;
					ctx.moveTo(x, y - d);
					ctx.lineTo(x + d, y);
					ctx.lineTo(x, y + d);
					ctx.lineTo(x - d, y);
					ctx.closePath();
				} else ctx.arc(x, y, r * (1 + breathe), 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = rgba(nc, .9 * alpha);
				ctx.lineWidth = 1.5;
				ctx.shadowColor = rgba(nc, 1);
				ctx.shadowBlur = live ? 16 : 8;
				ctx.stroke();
				ctx.restore();
			}
			const speed = off ? 0 : live ? 1.4 : loop.status === "erroring" ? .2 : .35;
			const spin = (nodeAngle.get(loop.id) ?? node.angle) + (reduced ? 0 : speed * dt);
			nodeAngle.set(loop.id, spin);
			if (look.shape !== "contact") {
				ctx.save();
				ctx.strokeStyle = rgba(nc, .6 * alpha);
				ctx.lineWidth = 1;
				ctx.setLineDash([3, 4]);
				ctx.beginPath();
				ctx.arc(x, y, r * 1.35, spin, spin + Math.PI * 2);
				ctx.stroke();
				ctx.restore();
			}
			if (checks.isChecking(loop.id)) {
				const inner = r * 1.35;
				const outer = r * 1.85;
				const trail = Math.PI * .9;
				const sweep = reduced ? -Math.PI / 2 : time * 4.2;
				ctx.save();
				const grad = typeof ctx.createConicGradient === "function" ? ctx.createConicGradient(sweep - trail, x, y) : null;
				if (grad) {
					const lead = trail / (Math.PI * 2);
					grad.addColorStop(0, rgba(palette.running, 0));
					grad.addColorStop(lead, rgba(palette.running, .42));
					grad.addColorStop(Math.min(1, lead + 5e-4), rgba(palette.running, 0));
					grad.addColorStop(1, rgba(palette.running, 0));
					ctx.fillStyle = grad;
					ctx.beginPath();
					ctx.arc(x, y, outer, 0, Math.PI * 2);
					ctx.arc(x, y, inner, 0, Math.PI * 2, true);
					ctx.fill();
				}
				ctx.strokeStyle = rgba(palette.running, .95);
				ctx.lineWidth = 2;
				ctx.lineCap = "round";
				ctx.shadowColor = rgba(palette.running, 1);
				ctx.shadowBlur = 10;
				ctx.beginPath();
				ctx.arc(x, y, outer, sweep - .55, sweep);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(x + Math.cos(sweep) * inner, y + Math.sin(sweep) * inner);
				ctx.lineTo(x + Math.cos(sweep) * outer, y + Math.sin(sweep) * outer);
				ctx.stroke();
				if (!reduced) for (let k = 0; k < 3; k++) {
					const t = (time * .9 + k / 3) % 1;
					ctx.fillStyle = rgba(palette.running, .9 * Math.sin(Math.PI * t));
					ctx.beginPath();
					ctx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1.6, 0, Math.PI * 2);
					ctx.fill();
				}
				ctx.restore();
			}
			const landed = checks.lastCheck(loop.id);
			const since = landed ? (Date.now() - landed.at) / 1e3 : Infinity;
			if (landed && since >= 0 && since < 1.4 && !reduced) {
				const k = since / 1.4;
				const pc = landed.error ? palette.danger : landed.found ? palette.running : mix(nc, palette.text, .3);
				ctx.save();
				ctx.strokeStyle = rgba(pc, (1 - k) * (landed.found ? .95 : .6));
				ctx.lineWidth = 2 * (1 - k) + .5;
				ctx.shadowColor = rgba(pc, 1);
				ctx.shadowBlur = 12;
				ctx.beginPath();
				ctx.arc(x, y, r * (1.3 + 2.4 * k), 0, Math.PI * 2);
				ctx.stroke();
				ctx.restore();
			}
			const n = Math.max(1, loop.stages.length);
			const orbit = r * 1.85;
			const span = Math.PI * 2 / n;
			const gap = n > 1 ? .28 : 0;
			const at = sessions[0]?.stage_index ?? -1;
			for (let i = 0; i < (look.stages === "none" ? 0 : n); i++) {
				const a0 = -Math.PI / 2 + i * span + gap / 2;
				const done = i < at;
				const now = i === at;
				ctx.save();
				ctx.strokeStyle = now ? rgba(blocked ? palette.warn : palette.running, .95) : done ? rgba(palette.running, .6) : rgba(nc, .28 * alpha);
				ctx.lineWidth = now ? 3 : 2;
				if (now) {
					ctx.shadowColor = rgba(blocked ? palette.warn : palette.running, 1);
					ctx.shadowBlur = 10;
				}
				if (look.stages === "segments") {
					ctx.lineCap = "butt";
					ctx.lineWidth = now ? 4 : 3;
					const block = 5 / orbit;
					for (let d = a0; d < a0 + span - gap; d += block) {
						ctx.beginPath();
						ctx.arc(x, y, orbit, d, Math.min(a0 + span - gap, d + block * .62));
						ctx.stroke();
					}
				} else {
					ctx.beginPath();
					ctx.arc(x, y, orbit, a0, a0 + span - gap);
					ctx.stroke();
				}
				ctx.restore();
			}
			const scar = checks.scar?.(loop.id) ?? 0;
			if (scar > .04) {
				const sr = r * 2.25;
				const seed = [...loop.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
				ctx.save();
				ctx.strokeStyle = rgba(palette.danger, (.15 + .55 * scar) * alpha);
				ctx.lineWidth = 1 + scar;
				ctx.beginPath();
				let a = seed % 628 / 100;
				const end = a + Math.PI * 2;
				let k = 0;
				while (a < end - .15) {
					const len = .35 + seed * (k + 3) % 70 / 100;
					const to = Math.min(end - .12, a + len);
					ctx.moveTo(x + Math.cos(a) * sr, y + Math.sin(a) * sr);
					const mid = (a + to) / 2;
					ctx.lineTo(x + Math.cos(mid) * (sr + (k % 2 ? 1.5 : -1.5)), y + Math.sin(mid) * (sr + (k % 2 ? 1.5 : -1.5)));
					ctx.lineTo(x + Math.cos(to) * sr, y + Math.sin(to) * sr);
					a = to + .12 + seed * (k + 7) % 20 / 100;
					k++;
				}
				ctx.stroke();
				ctx.restore();
			}
			if ((checks.waiting?.(loop.id) ?? 0) > 0) {
				const { x: bx, y: by } = beaconAt(node);
				const warm = palette.warn;
				ctx.save();
				if (!reduced) {
					const phase = (time * .6 + index * .13) % 1;
					ctx.strokeStyle = rgba(warm, .7 * (1 - phase));
					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.arc(x, y, r * (1.2 + phase * 1.5), 0, Math.PI * 2);
					ctx.stroke();
				}
				ctx.fillStyle = rgba(warm, .95);
				ctx.shadowColor = rgba(warm, 1);
				ctx.shadowBlur = 12;
				ctx.beginPath();
				ctx.moveTo(bx, by - 6);
				ctx.lineTo(bx + 6, by);
				ctx.lineTo(bx, by + 6);
				ctx.lineTo(bx - 6, by);
				ctx.closePath();
				ctx.fill();
				ctx.restore();
			}
			if (look.stages !== "none") sessions.forEach((session, k) => {
				const a0 = -Math.PI / 2 + session.stage_index * span + gap / 2;
				const drift = reduced ? .5 : .5 + .4 * Math.sin(time * 1.3 + k * 2);
				const a = a0 + (span - gap) * drift;
				const sx = x + Math.cos(a) * orbit;
				const sy = y + Math.sin(a) * orbit;
				satellites.push({
					x: sx,
					y: sy,
					session
				});
				const isBlocked = session.status === "blocked";
				const sc = isBlocked ? palette.warn : mix(palette.running, palette.text, .4);
				ctx.save();
				if (isBlocked) {
					const phase = time * 1.4 % 1;
					ctx.strokeStyle = rgba(palette.warn, reduced ? .6 : .8 * (1 - phase));
					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.arc(sx, sy, reduced ? 9 : 6 + 9 * phase, 0, Math.PI * 2);
					ctx.stroke();
				}
				const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 11);
				g.addColorStop(0, rgba(sc, .95));
				g.addColorStop(1, rgba(sc, 0));
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.arc(sx, sy, 11, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = "rgba(255,255,255,0.95)";
				ctx.beginPath();
				ctx.arc(sx, sy, 2.8, 0, Math.PI * 2);
				ctx.fill();
				ctx.restore();
			});
			ctx.restore();
		}
		return satellites;
	}
	/** A loop's node in one of the other shapes. AstroAI's own loops carry a diamond inside; plug-ins a dot. */
	function drawShape(env, shape, x, y, r, c, alpha, live, lit, builtin, disabled) {
		const { ctx } = env;
		const glowA = Math.min(1, (disabled ? .3 : .9) * alpha + lit * .5);
		const mark = (size, fill) => {
			ctx.fillStyle = fill;
			ctx.beginPath();
			if (builtin) {
				ctx.moveTo(x, y - size);
				ctx.lineTo(x + size, y);
				ctx.lineTo(x, y + size);
				ctx.lineTo(x - size, y);
				ctx.closePath();
			} else ctx.arc(x, y, size * .8, 0, Math.PI * 2);
			ctx.fill();
		};
		ctx.save();
		ctx.shadowColor = rgba(c, 1);
		if (shape === "hex") {
			hexPath(ctx, x, y, r * 1.15);
			const fill = ctx.createLinearGradient(x, y - r, x, y + r);
			fill.addColorStop(0, rgba(c, (disabled ? .08 : .45) * alpha));
			fill.addColorStop(1, rgba(mix(c, [
				0,
				0,
				0
			], .7), .85 * alpha));
			ctx.fillStyle = fill;
			ctx.fill();
			ctx.strokeStyle = rgba(c, glowA);
			ctx.lineWidth = 1.6;
			ctx.shadowBlur = live ? 16 : 8;
			ctx.stroke();
			ctx.shadowBlur = 0;
			hexPath(ctx, x, y, r * .62);
			ctx.strokeStyle = rgba(c, .45 * alpha);
			ctx.lineWidth = 1;
			ctx.stroke();
			mark(r * .3, rgba(mix(c, [
				255,
				255,
				255
			], .6), glowA));
		} else if (shape === "contact") {
			const glow = Math.min(1, (live ? .85 : .35) * alpha + lit * .65);
			ctx.shadowBlur = 6 + 14 * Math.max(lit, live ? .6 : 0);
			mark(r * .45, rgba(mix(c, [
				255,
				255,
				255
			], .35 * glow), glow));
			const s = r * 1.15;
			const len = s * .45;
			ctx.strokeStyle = rgba(c, Math.max(.3 * alpha, glow));
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (const [sx, sy] of [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1]
			]) {
				ctx.moveTo(x + sx * s, y + sy * (s - len));
				ctx.lineTo(x + sx * s, y + sy * s);
				ctx.lineTo(x + sx * (s - len), y + sy * s);
			}
			ctx.stroke();
		} else if (shape === "box") {
			const s = r * 1.05;
			ctx.strokeStyle = rgba(c, glowA);
			ctx.lineWidth = 1.5;
			ctx.shadowBlur = live ? 12 : 5;
			ctx.beginPath();
			for (const side of [-1, 1]) {
				ctx.moveTo(x + side * s * .45, y - s);
				ctx.lineTo(x + side * s, y - s);
				ctx.lineTo(x + side * s, y + s);
				ctx.lineTo(x + side * s * .45, y + s);
			}
			ctx.stroke();
			ctx.fillStyle = rgba(c, .1 * alpha);
			ctx.fillRect(x - s, y - s, s * 2, s * 2);
			const on = !live || env.reduced || Math.sin(env.time * 8) > 0;
			ctx.fillStyle = rgba(mix(c, [
				255,
				255,
				255
			], .5), on ? glowA : .2 * glowA);
			if (builtin) mark(r * .32, ctx.fillStyle);
			else ctx.fillRect(x - r * .28, y - r * .42, r * .56, r * .84);
		} else if (shape === "eq") {
			ctx.strokeStyle = rgba(c, glowA);
			ctx.lineWidth = 1.6;
			ctx.shadowBlur = live ? 14 : 6;
			ctx.beginPath();
			ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
			ctx.stroke();
			ctx.fillStyle = rgba(c, .1 * alpha);
			ctx.fill();
			ctx.shadowBlur = 0;
			ctx.fillStyle = rgba(mix(c, [
				255,
				255,
				255
			], .35), glowA);
			const bars = 5;
			const bw = r * 1.1 / bars;
			for (let i = 0; i < bars; i++) {
				const level = live && !env.reduced ? .25 + .75 * Math.abs(Math.sin(env.time * (4 + i * 1.3) + i * 2)) : .2 + .12 * (i * 3 % 4);
				const bh = r * 1.2 * level;
				ctx.fillRect(x - r * .55 + i * bw + bw * .15, y + r * .55 - bh, bw * .7, bh);
			}
		} else if (shape === "pressure") {
			const disc = ctx.createRadialGradient(x, y, 0, x, y, r * 1.2);
			disc.addColorStop(0, rgba(c, (live ? .4 : .16) * alpha));
			disc.addColorStop(1, rgba(c, 0));
			ctx.fillStyle = disc;
			ctx.beginPath();
			ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
			ctx.fill();
			ctx.font = `700 ${Math.round(r * 1.25)}px ui-sans-serif, system-ui, sans-serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.shadowBlur = live ? 14 : 6;
			ctx.fillStyle = rgba(live ? env.palette.warn : mix(c, [
				255,
				255,
				255
			], .4), glowA);
			ctx.fillText(live ? "L" : "H", x, y + 1);
			if (builtin) {
				ctx.strokeStyle = rgba(c, .6 * alpha);
				ctx.lineWidth = 1;
				ctx.strokeRect(x - r * .9, y - r * .9, r * 1.8, r * 1.8);
			}
		} else if (shape === "neon") {
			ctx.lineWidth = 2;
			ctx.shadowBlur = live ? 18 : 10;
			ctx.strokeStyle = rgba(c, glowA);
			ctx.beginPath();
			ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
			ctx.stroke();
			const warm = env.palette.warn;
			ctx.shadowColor = rgba(warm, 1);
			ctx.strokeStyle = rgba(warm, (disabled ? .3 : .85) * alpha);
			ctx.beginPath();
			ctx.arc(x, y, r * .68, 0, Math.PI * 2);
			ctx.stroke();
			mark(r * .26, rgba([
				255,
				255,
				255
			], glowA));
		} else {
			ctx.strokeStyle = rgba(c, glowA);
			ctx.lineWidth = 2.6;
			ctx.shadowBlur = live ? 16 : 8;
			ctx.beginPath();
			ctx.arc(x, y, r * .95, 0, Math.PI * 2);
			ctx.stroke();
			ctx.fillStyle = rgba(c, .12 * alpha);
			ctx.fill();
			mark(r * .38, rgba(mix(c, [
				255,
				255,
				255
			], .55), glowA));
		}
		ctx.restore();
	}
	/** Streaks into the core from finished runs; returns the ones still going. */
	function drawBursts(env, bursts) {
		const { ctx, palette, col, dt, cx, cy, R } = env;
		const alive = bursts.filter((b) => b.life > 0 && b.r > .2);
		for (const b of alive) {
			b.v += dt * .9;
			b.r -= b.v * dt;
			b.life -= dt * .55;
			const rr = b.r * R;
			const x = cx + Math.cos(b.a) * rr;
			const y = cy + Math.sin(b.a) * rr;
			const tail = Math.min(18, b.v * 30);
			ctx.strokeStyle = rgba(mix(col, palette.text, .5), Math.min(1, b.life) * .9);
			ctx.lineWidth = b.size;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(cx + Math.cos(b.a) * (rr + tail), cy + Math.sin(b.a) * (rr + tail));
			ctx.stroke();
		}
		return alive;
	}

// web/src/lib/.port/singularity.ts
	const TAU = Math.PI * 2;
	function singularity(env, s) {
		const { ctx, col, time, dt, reduced, flicker, cx, cy, R } = env;
		const hole = R * .2;
		const tilt = .3;
		const motes = s.field.map((p) => {
			const r = hole * 1.35 + (p.r - .25) / .95 * R * .95;
			if (!reduced) p.a += dt * (.25 + 1.6 * (hole / r) ** 1.5) * (.6 + s.energy * .6);
			return {
				p,
				r
			};
		});
		const disc = (side) => {
			for (const { p, r } of motes) {
				const sin = Math.sin(p.a);
				if (side === "back" !== sin < 0) continue;
				const heat = Math.max(0, 1 - (r - hole) / (R * .9));
				const c = mix(col, [
					255,
					255,
					255
				], heat * .7);
				const trail = .18 + heat * .3;
				ctx.strokeStyle = rgba(c, (.25 + .65 * heat) * s.energy * flicker);
				ctx.lineWidth = p.size * (.6 + heat);
				ctx.beginPath();
				ctx.ellipse(cx, cy, r, r * tilt, 0, p.a - trail, p.a);
				ctx.stroke();
			}
		};
		ctx.save();
		const halo = ctx.createRadialGradient(cx, cy, hole, cx, cy, R * 1.2);
		halo.addColorStop(0, rgba(col, .28 * s.energy * flicker));
		halo.addColorStop(1, rgba(col, 0));
		ctx.fillStyle = halo;
		ctx.beginPath();
		ctx.arc(cx, cy, R * 1.2, 0, TAU);
		ctx.fill();
		disc("back");
		ctx.strokeStyle = rgba(mix(col, [
			255,
			255,
			255
		], .5), .7 * flicker);
		ctx.lineWidth = 3;
		ctx.shadowColor = rgba(col, 1);
		ctx.shadowBlur = 18;
		ctx.beginPath();
		ctx.ellipse(cx, cy, hole * 1.32, hole * 1.12, 0, Math.PI, TAU);
		ctx.stroke();
		ctx.shadowBlur = 0;
		ctx.fillStyle = "rgba(0, 0, 0, 0.96)";
		ctx.beginPath();
		ctx.arc(cx, cy, hole, 0, TAU);
		ctx.fill();
		ctx.strokeStyle = rgba(mix(col, [
			255,
			255,
			255
		], .7), (.75 + .25 * s.pulse * s.energy) * flicker);
		ctx.lineWidth = 1.6;
		ctx.shadowColor = rgba(col, 1);
		ctx.shadowBlur = 14;
		ctx.beginPath();
		ctx.arc(cx, cy, hole * 1.04, 0, TAU);
		ctx.stroke();
		ctx.shadowBlur = 0;
		disc("front");
		ctx.restore();
		for (let i = 0; i < Math.min(6, s.runCount); i++) {
			const a = (reduced ? 0 : time * (.5 + i * .1)) + i * 1.9;
			const r = hole * 1.6 + R * .12 * (i % 3);
			ctx.save();
			ctx.fillStyle = rgba([
				255,
				255,
				255
			], .95 * flicker);
			ctx.shadowColor = rgba(col, 1);
			ctx.shadowBlur = 12;
			ctx.beginPath();
			ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * tilt, 2.4, 0, TAU);
			ctx.fill();
			ctx.restore();
		}
		return {
			rings: [],
			satellites: drawNodes(env, s.nodes, s.sessions, s.motion, s.checks, {
				shape: "orb",
				link: "spiral",
				stages: "arc"
			}),
			bursts: drawBursts(env, s.bursts)
		};
	}

// web/src/lib/.port/entry-singularity.ts
	astroai.style({ draw: (g) => adapt(g, singularity) });

})();