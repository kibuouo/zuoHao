import { analyze, extractMetrics, fuseFaceIntoPose, isHeadCollapsed, isUpperBodyVisible } from "../renderer/js/analyze.js";

function pose(overrides) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.08 }));
  for (const [key, value] of Object.entries(overrides)) {
    lm[Number(key)] = { x: 0.5, y: 0.5, z: 0, visibility: 0.92, ...value };
  }
  return lm;
}

const settings = {
  sensitivity: "standard",
  viewMode: "side",
  checks: { forwardHead: true, slouch: true, headTilt: true, unevenShoulders: true, lean: true },
};
const aspect = 16 / 9;

const upright = pose({
  0: { x: 0.44, y: 0.28 },
  2: { x: 0.45, y: 0.27 },
  5: { x: 0.47, y: 0.27, visibility: 0.35 },
  7: { x: 0.5, y: 0.3 },
  8: { x: 0.52, y: 0.3, visibility: 0.28 },
  9: { x: 0.44, y: 0.34 },
  10: { x: 0.45, y: 0.34, visibility: 0.4 },
  11: { x: 0.5, y: 0.48 },
  12: { x: 0.55, y: 0.48, visibility: 0.4 },
  23: { x: 0.51, y: 0.78, visibility: 0.6 },
  24: { x: 0.55, y: 0.78, visibility: 0.4 },
});

const obvious = pose({
  0: { x: 0.3, y: 0.3 },
  2: { x: 0.31, y: 0.29 },
  5: { x: 0.34, y: 0.29, visibility: 0.3 },
  7: { x: 0.36, y: 0.32 },
  8: { x: 0.39, y: 0.32, visibility: 0.25 },
  9: { x: 0.28, y: 0.36 },
  10: { x: 0.3, y: 0.36, visibility: 0.35 },
  11: { x: 0.5, y: 0.48 },
  12: { x: 0.55, y: 0.48, visibility: 0.4 },
  23: { x: 0.51, y: 0.78, visibility: 0.6 },
  24: { x: 0.55, y: 0.78, visibility: 0.4 },
});

const mild = pose({
  0: { x: 0.38, y: 0.29 },
  2: { x: 0.39, y: 0.28 },
  7: { x: 0.43, y: 0.31 },
  8: { x: 0.46, y: 0.31, visibility: 0.25 },
  9: { x: 0.37, y: 0.35 },
  10: { x: 0.38, y: 0.35, visibility: 0.35 },
  11: { x: 0.5, y: 0.48 },
  12: { x: 0.55, y: 0.48, visibility: 0.4 },
  23: { x: 0.51, y: 0.78, visibility: 0.6 },
  24: { x: 0.55, y: 0.78, visibility: 0.4 },
});

let failed = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`ok  ${name}`);
  else {
    failed += 1;
    console.error(`fail ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

check("upright visible", isUpperBodyVisible(upright));
check("obvious visible", isUpperBodyVisible(obvious));

const upM = extractMetrics(upright, { aspect, viewHint: "side" });
const badM = extractMetrics(obvious, { aspect, viewHint: "side" });
const mildM = extractMetrics(mild, { aspect, viewHint: "side" });

check("upright CVA high", upM.cva >= 54, `cva=${upM.cva.toFixed(1)} earFwd=${upM.earForward.toFixed(2)}`);
check("obvious CVA low", badM.cva <= 42, `cva=${badM.cva.toFixed(1)} earFwd=${badM.earForward.toFixed(2)}`);
check("obvious ear in front", badM.earForward > upM.earForward + 0.2, `up=${upM.earForward.toFixed(2)} bad=${badM.earForward.toFixed(2)}`);
check("mild between", mildM.cva < upM.cva && mildM.cva > badM.cva, `mild=${mildM.cva.toFixed(1)}`);

const upA = analyze(upright, null, settings, { aspect });
const badA = analyze(obvious, null, settings, { aspect });
const mildA = analyze(mild, null, settings, { aspect });

check("upright no FHP", !upA.issues.some((i) => i.id === "forwardHead"), JSON.stringify(upA.issues));
check("obvious FHP alert", badA.issues.some((i) => i.id === "forwardHead" && i.severity === "alert"), JSON.stringify(badA.issues));
check("mild FHP at least warn", mildA.issues.some((i) => i.id === "forwardHead"), `cva=${mildM.cva.toFixed(1)} issues=${JSON.stringify(mildA.issues)}`);

const worldObvious = obvious.map((p, i) => {
  if (i === 7) return { x: -0.09, y: -0.45, z: -0.05, visibility: 0.9 };
  if (i === 11) return { x: 0, y: -0.28, z: 0, visibility: 0.9 };
  return { x: 0, y: 0, z: 0, visibility: p.visibility };
});
const worldA = analyze(obvious, null, settings, { aspect, world: worldObvious });
check(
  "world displacement also flags",
  worldA.issues.some((i) => i.id === "forwardHead"),
  JSON.stringify(worldA.metrics.worldEarForward)
);

const obviousRight = pose({
  0: { x: 0.7, y: 0.3 },
  2: { x: 0.66, y: 0.29, visibility: 0.3 },
  5: { x: 0.69, y: 0.29 },
  7: { x: 0.61, y: 0.32, visibility: 0.25 },
  8: { x: 0.64, y: 0.32 },
  9: { x: 0.7, y: 0.36, visibility: 0.35 },
  10: { x: 0.72, y: 0.36 },
  11: { x: 0.45, y: 0.48, visibility: 0.4 },
  12: { x: 0.5, y: 0.48 },
  23: { x: 0.45, y: 0.78, visibility: 0.4 },
  24: { x: 0.49, y: 0.78, visibility: 0.6 },
});
const rightA = analyze(obviousRight, null, settings, { aspect });
check("right-facing FHP", rightA.issues.some((i) => i.id === "forwardHead"), JSON.stringify(rightA.issues));
check("right-facing sign", rightA.metrics.facing === "right", rightA.metrics.facing);

check("side still evaluates tilt/slope/lean", ["headTilt", "unevenShoulders", "lean"].every((id) => settings.checks[id]));
check("upright no tilt if not ready", !upA.issues.some((i) => i.id === "headTilt"), JSON.stringify(upA.issues));

const worldTilt = upright.map((p, i) => {
  if (i === 7) return { x: 0, y: -0.46, z: -0.07, visibility: 0.9 };
  if (i === 8) return { x: 0, y: -0.52, z: 0.07, visibility: 0.9 };
  if (i === 11) return { x: 0, y: -0.26, z: -0.1, visibility: 0.9 };
  if (i === 12) return { x: 0, y: -0.32, z: 0.1, visibility: 0.9 };
  if (i === 23) return { x: 0, y: 0.05, z: -0.02, visibility: 0.8 };
  if (i === 24) return { x: 0, y: 0.05, z: 0.02, visibility: 0.8 };
  return { x: 0, y: 0, z: 0, visibility: p.visibility };
});
const tiltA = analyze(upright, null, settings, { aspect, world: worldTilt });
check("side world head tilt fires", tiltA.issues.some((i) => i.id === "headTilt"), JSON.stringify(tiltA.issues));
check("side world uneven shoulder fires", tiltA.issues.some((i) => i.id === "unevenShoulders"), JSON.stringify(tiltA.issues));
check("tilt source world", tiltA.metrics.tiltSource === "world", tiltA.metrics.tiltSource);

const worldLean = upright.map((p, i) => {
  if (i === 11) return { x: 0, y: -0.28, z: -0.12, visibility: 0.9 };
  if (i === 12) return { x: 0, y: -0.28, z: -0.1, visibility: 0.9 };
  if (i === 23) return { x: 0, y: 0.05, z: 0.01, visibility: 0.85 };
  if (i === 24) return { x: 0, y: 0.05, z: 0.02, visibility: 0.85 };
  if (i === 7) return { x: -0.02, y: -0.48, z: -0.06, visibility: 0.9 };
  if (i === 8) return { x: -0.02, y: -0.48, z: 0.06, visibility: 0.9 };
  return { x: 0, y: 0, z: 0, visibility: p.visibility };
});
const leanA = analyze(upright, null, settings, { aspect, world: worldLean });
check("side world lean fires", leanA.issues.some((i) => i.id === "lean"), JSON.stringify(leanA.issues));

const worldLevel = upright.map((p, i) => {
  if (i === 7) return { x: 0, y: -0.48, z: -0.06, visibility: 0.9 };
  if (i === 8) return { x: 0, y: -0.48, z: 0.06, visibility: 0.9 };
  if (i === 11) return { x: 0, y: -0.28, z: -0.08, visibility: 0.9 };
  if (i === 12) return { x: 0, y: -0.28, z: 0.08, visibility: 0.9 };
  if (i === 23) return { x: 0, y: 0.05, z: -0.02, visibility: 0.85 };
  if (i === 24) return { x: 0, y: 0.05, z: 0.02, visibility: 0.85 };
  return { x: 0, y: 0, z: 0, visibility: p.visibility };
});
const levelA = analyze(upright, null, settings, { aspect, world: worldLevel });
check(
  "level side world no frontal issues",
  !levelA.issues.some((i) => i.id === "headTilt" || i.id === "unevenShoulders" || i.id === "lean"),
  JSON.stringify(levelA.issues)
);

const collapsed = pose({
  0: { x: 0.51, y: 0.31 },
  7: { x: 0.5, y: 0.3 },
  8: { x: 0.515, y: 0.3, visibility: 0.3 },
  9: { x: 0.505, y: 0.32 },
  11: { x: 0.5, y: 0.48 },
});
check("collapsed head detected", isHeadCollapsed(collapsed));
check("upright head not collapsed", !isHeadCollapsed(upright));

const chairFar = pose({
  0: { x: 0.44, y: 0.28 },
  7: { x: 0.5, y: 0.3 },
  11: { x: 0.5, y: 0.48 },
  12: { x: 0.78, y: 0.52, visibility: 0.7 },
  23: { x: 0.51, y: 0.78, visibility: 0.6 },
});
const chairM = extractMetrics(chairFar, { aspect, viewHint: "side" });
check("C7 stays on the neck not the chair", Math.abs(chairM.c7.x - chairFar[7].x) < 0.12 && Math.abs(chairM.c7.x - 0.78) > 0.12, `c7.x=${chairM.c7.x.toFixed(3)} ear=${chairFar[7].x}`);
check("C7 between ear and shoulder", chairM.c7.y > chairFar[7].y && chairM.c7.y < chairFar[11].y, `c7.y=${chairM.c7.y.toFixed(3)}`);

const fakeFace = Array.from({ length: 478 }, () => ({ x: 0.4, y: 0.3, z: 0 }));
fakeFace[1] = { x: 0.36, y: 0.3, z: 0 };
fakeFace[33] = { x: 0.34, y: 0.27, z: 0 };
fakeFace[263] = { x: 0.4, y: 0.27, z: 0 };
fakeFace[234] = { x: 0.48, y: 0.3, z: 0 };
fakeFace[454] = { x: 0.5, y: 0.3, z: 0 };
fakeFace[61] = { x: 0.35, y: 0.34, z: 0 };
fakeFace[291] = { x: 0.39, y: 0.34, z: 0 };
fakeFace[152] = { x: 0.37, y: 0.38, z: 0 };
const fused = fuseFaceIntoPose(collapsed, fakeFace);
check("face fusion moves nose off ear", fused.fused && fused.landmarks[0].x === 0.36, `nose=${fused.landmarks[0].x}`);
check("fused head not collapsed", !isHeadCollapsed(fused.landmarks));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
