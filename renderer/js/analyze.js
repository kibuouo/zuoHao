/** 好坐姿态分析。默认按斜侧 45° 机位：颈根取头底下的肩，前倾看相对校准的耳–肩和 3D 位移。 */

export const CHECKS = {
  forwardHead: {
    id: "forwardHead",
    name: "脖子前倾",
    hint: "耳廓跑到肩峰前方，颈椎长时间悬臂",
    fix: "下颌微收，后脑勺往上顶。让耳朵回到头底下那侧肩膀的上方",
  },
  slouch: {
    id: "slouch",
    name: "含胸驼背",
    hint: "肩峰前卷、胸廓塌陷",
    fix: "肩胛骨轻轻下沉后夹，胸口打开，不要挺肚子代偿",
  },
  headTilt: {
    id: "headTilt",
    name: "头侧倾",
    hint: "头向一侧歪，单边颈肌持续受力",
    fix: "双眼平视屏幕，让两耳大致等高",
  },
  unevenShoulders: {
    id: "unevenShoulders",
    name: "高低肩",
    hint: "左右肩峰不在同一水平",
    fix: "双手离开脸颊和单侧支架，让两肩同时放下",
  },
  lean: {
    id: "lean",
    name: "身体侧倾",
    hint: "躯干离开中线，体重压在一侧坐骨",
    fix: "坐骨同时着椅，肋骨对准骨盆",
  },
};

const SENSITIVITY = {
  strict: { angle: 0.82, depth: 0.82, drop: 0.85 },
  standard: { angle: 1, depth: 1, drop: 1 },
  relaxed: { angle: 1.22, depth: 1.28, drop: 1.2 },
};

export const ALGORITHM_DEFAULTS = {
  version: 3,
  cvaWarn: 52,
  cvaAlert: 46,
  cvaHardAlert: 38,
  pokeWarn: 0.28,
  pokeCva: 56,
  earFwdWarn: 0.24,
  earFwdAlert: 0.42,
  chinFwdWarn: 0.9,
  chinFwdAlert: 1.25,
  worldFwdWarn: 0.04,
  worldFwdAlert: 0.075,
  trunkWarn: 12,
  trunkAlert: 20,
  tiltLimit: 7.5,
  slopeLimit: 6.5,
  leanLimit: 8,
  tiltLimitSide: 9.5,
  slopeLimitSide: 8.5,
  leanLimitSide: 10,
  smoothAlpha: 0.2,
  smoothAlphaDown: 0.48,
  landmarkAlphaSide: 0.34,
  landmarkAlphaFront: 0.38,
  forwardHoldMs: 2000,
};

export const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

const I = {
  NOSE: 0,
  L_EYE: 2,
  R_EYE: 5,
  L_EAR: 7,
  R_EAR: 8,
  L_MOUTH: 9,
  R_MOUTH: 10,
  L_SH: 11,
  R_SH: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_HIP: 23,
  R_HIP: 24,
};

function algoOf(settings) {
  return { ...ALGORITHM_DEFAULTS, ...(settings && settings.algorithm) };
}

function vis(p) {
  return p && typeof p.visibility === "number" ? p.visibility : 0;
}

function mid(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z || 0) + (b.z || 0)) / 2,
    visibility: Math.min(vis(a), vis(b)),
  };
}

function blend(points, weights) {
  let x = 0;
  let y = 0;
  let z = 0;
  let wsum = 0;
  let v = 1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const w = (weights[i] || 1) * Math.max(vis(p), 0.05);
    x += p.x * w;
    y += p.y * w;
    z += (p.z || 0) * w;
    wsum += w;
    v = Math.min(v, vis(p) || v);
  }
  if (wsum <= 0) return null;
  return { x: x / wsum, y: y / wsum, z: z / wsum, visibility: v };
}

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function deg(rad) {
  return (rad * 180) / Math.PI;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function sagX(p, aspect) {
  return p.x * aspect;
}

export function isUpperBodyVisible(lm) {
  if (!lm || lm.length < 13) return false;
  const hasHead = vis(lm[I.NOSE]) > 0.22 || vis(lm[I.L_EAR]) > 0.22 || vis(lm[I.R_EAR]) > 0.22 || vis(lm[I.L_EYE]) > 0.28 || vis(lm[I.R_EYE]) > 0.28;
  const hasShoulder = vis(lm[I.L_SH]) > 0.24 || vis(lm[I.R_SH]) > 0.24;
  const hasAnchor = vis(lm[I.L_EAR]) > 0.18 || vis(lm[I.R_EAR]) > 0.18 || vis(lm[I.L_MOUTH]) > 0.22 || vis(lm[I.R_MOUTH]) > 0.22;
  return hasHead && hasShoulder && hasAnchor;
}

export function classifyView(lm, aspect = 16 / 9) {
  const lEar = lm[I.L_EAR];
  const rEar = lm[I.R_EAR];
  const lSh = lm[I.L_SH];
  const rSh = lm[I.R_SH];
  const lEye = lm[I.L_EYE];
  const rEye = lm[I.R_EYE];

  const shoulderW = dist2(lSh, rSh) * aspect;
  const earSep = dist2(lEar, rEar) * aspect;
  const eyeSep = dist2(lEye, rEye) * aspect;
  const visAsymSh = Math.abs(vis(lSh) - vis(rSh));
  const visAsymEar = Math.abs(vis(lEar) - vis(rEar));

  let sideScore = 0;
  if (shoulderW < 0.22) sideScore += 2;
  if (shoulderW < 0.14) sideScore += 1;
  if (earSep < 0.1) sideScore += 2;
  if (eyeSep < 0.08) sideScore += 1;
  if (visAsymSh > 0.22) sideScore += 1;
  if (visAsymEar > 0.22) sideScore += 1;

  let view = "front";
  if (sideScore >= 5) view = "side";
  else if (sideScore >= 3) view = "oblique";

  return { view, sideScore, shoulderW, earSep };
}

function pickProfile(lm) {
  const leftScore =
    vis(lm[I.L_EAR]) * 1.3 +
    vis(lm[I.L_SH]) +
    vis(lm[I.L_EYE]) * 0.45 +
    vis(lm[I.L_MOUTH]) * 0.35;
  const rightScore =
    vis(lm[I.R_EAR]) * 1.3 +
    vis(lm[I.R_SH]) +
    vis(lm[I.R_EYE]) * 0.45 +
    vis(lm[I.R_MOUTH]) * 0.35;
  const side = leftScore >= rightScore ? "left" : "right";
  const near = side === "left"
    ? { ear: I.L_EAR, eye: I.L_EYE, mouth: I.L_MOUTH, sh: I.L_SH, elbow: I.L_ELBOW, hip: I.L_HIP }
    : { ear: I.R_EAR, eye: I.R_EYE, mouth: I.R_MOUTH, sh: I.R_SH, elbow: I.R_ELBOW, hip: I.R_HIP };
  const far = side === "left"
    ? { ear: I.R_EAR, eye: I.R_EYE, mouth: I.R_MOUTH, sh: I.R_SH, hip: I.R_HIP }
    : { ear: I.L_EAR, eye: I.L_EYE, mouth: I.L_MOUTH, sh: I.L_SH, hip: I.L_HIP };

  const ear = vis(lm[near.ear]) >= 0.16 ? lm[near.ear] : vis(lm[far.ear]) >= 0.16 ? lm[far.ear] : lm[near.ear];
  const shoulder = vis(lm[near.sh]) >= 0.18 ? lm[near.sh] : vis(lm[far.sh]) >= 0.18 ? lm[far.sh] : lm[near.sh];
  const hip = vis(lm[near.hip]) >= 0.14 ? lm[near.hip] : vis(lm[far.hip]) >= 0.14 ? lm[far.hip] : null;
  const eye = vis(lm[near.eye]) >= 0.16 ? lm[near.eye] : vis(lm[far.eye]) >= 0.16 ? lm[far.eye] : lm[I.NOSE];
  const mouthNear = lm[near.mouth];
  const mouthFar = lm[far.mouth];
  const mouth = vis(mouthNear) >= 0.14 || vis(mouthFar) >= 0.14 ? blend([mouthNear, mouthFar], [1, 0.55]) : null;

  return {
    side,
    idx: near,
    farIdx: far,
    ear,
    shoulder,
    hip,
    eye,
    mouth,
    farShoulder: lm[far.sh],
    farHip: lm[far.hip],
  };
}

function inferForwardSign(nose, ear, mouth, eye) {
  const votes = [];
  const push = (front, back, minVis = 0.16) => {
    if (vis(front) < minVis || vis(back) < minVis) return;
    if (Math.abs(front.x - back.x) < 0.006) return;
    votes.push(front.x < back.x ? -1 : 1);
  };
  push(nose, ear);
  push(mouth, ear);
  push(eye, ear, 0.14);
  push(nose, mouth, 0.14);
  if (!votes.length) return nose.x <= ear.x ? -1 : 1;
  const sum = votes.reduce((a, b) => a + b, 0);
  if (sum === 0) return nose.x <= ear.x ? -1 : 1;
  return sum < 0 ? -1 : 1;
}

function sideIdx(side) {
  return side === "left"
    ? { ear: I.L_EAR, eye: I.L_EYE, mouth: I.L_MOUTH, sh: I.L_SH, elbow: I.L_ELBOW, hip: I.L_HIP }
    : { ear: I.R_EAR, eye: I.R_EYE, mouth: I.R_MOUTH, sh: I.R_SH, elbow: I.R_ELBOW, hip: I.R_HIP };
}

function chooseNeckAnchor(lm, face, facing, aspect, ambiguous) {
  // 45° and true-side both see the anatomical profile opposite the facing
  // direction: look left → right ear/shoulder, look right → left.
  const side = facing === "left" ? "right" : "left";
  const idx = sideIdx(side);
  const farIdx = sideIdx(side === "left" ? "right" : "left");
  const faceEar = face && (side === "left" ? face.lEar : face.rEar);
  const ear =
    vis(faceEar) >= 0.16 ? faceEar : vis(lm[idx.ear]) >= 0.16 ? lm[idx.ear] : vis(lm[farIdx.ear]) >= 0.16 ? lm[farIdx.ear] : lm[idx.ear];
  let shoulder = vis(lm[idx.sh]) >= 0.18 ? lm[idx.sh] : vis(lm[farIdx.sh]) >= 0.18 ? lm[farIdx.sh] : lm[idx.sh];
  let shoulderIdx = vis(lm[idx.sh]) >= 0.18 ? idx.sh : vis(lm[farIdx.sh]) >= 0.18 ? farIdx.sh : idx.sh;
  let source = "profile-side";
  const otherIdx = shoulderIdx === idx.sh ? farIdx.sh : idx.sh;
  const other = lm[otherIdx];
  if (ambiguous && other && vis(other) >= 0.18) {
    const spanN = dist2(shoulder, other) * aspect;
    const dx = Math.abs(ear.x - shoulder.x) * aspect;
    const dxOther = Math.abs(ear.x - other.x) * aspect;
    // Chair / background false positive: the profile-side point is isolated
    // and far from the head. Snap to the remaining shoulder.
    if (spanN > 0.46 && dx > 0.22 && dxOther < dx) {
      shoulder = other;
      shoulderIdx = otherIdx;
      source = "under-head";
    }
  }
  const hip = vis(lm[idx.hip]) >= 0.14 ? lm[idx.hip] : vis(lm[farIdx.hip]) >= 0.14 ? lm[farIdx.hip] : null;
  const hipIdx = vis(lm[idx.hip]) >= 0.14 ? idx.hip : vis(lm[farIdx.hip]) >= 0.14 ? farIdx.hip : null;
  const eye = vis(lm[idx.eye]) >= 0.16 ? lm[idx.eye] : vis(lm[farIdx.eye]) >= 0.16 ? lm[farIdx.eye] : lm[I.NOSE];
  return {
    side,
    idx,
    farIdx,
    ear,
    earIdx: vis(faceEar) >= 0.16 || vis(lm[idx.ear]) >= 0.16 ? idx.ear : farIdx.ear,
    shoulder,
    farShoulder: lm[otherIdx],
    shoulderIdx,
    source,
    hip,
    hipIdx,
    eye,
  };
}

export function isHeadCollapsed(lm) {
  if (!lm || !lm[I.NOSE] || !lm[I.L_EAR] || !lm[I.R_EAR]) return false;
  const ear = vis(lm[I.L_EAR]) >= vis(lm[I.R_EAR]) ? lm[I.L_EAR] : lm[I.R_EAR];
  const nose = lm[I.NOSE];
  const mouth = vis(lm[I.L_MOUTH]) >= vis(lm[I.R_MOUTH]) ? lm[I.L_MOUTH] : lm[I.R_MOUTH];
  const span = Math.max(dist2(nose, ear), mouth ? dist2(mouth, ear) : 0);
  return span < 0.038;
}

const FACE_TO_POSE = {
  0: 1,
  2: 33,
  5: 263,
  7: 234,
  8: 454,
  9: 61,
  10: 291,
};

export function fuseFaceIntoPose(poseLm, faceLm) {
  if (!poseLm || !faceLm || faceLm.length < 455) return { landmarks: poseLm, fused: false, extras: null };
  const next = poseLm.map((p) => ({ ...p }));
  for (const [poseIdx, faceIdx] of Object.entries(FACE_TO_POSE)) {
    const f = faceLm[Number(faceIdx)];
    if (!f) continue;
    next[Number(poseIdx)] = {
      x: f.x,
      y: f.y,
      z: typeof f.z === "number" ? f.z : next[Number(poseIdx)].z,
      visibility: 0.97,
    };
  }
  const extras = {
    chin: faceLm[152] ? { ...faceLm[152], visibility: 0.97 } : null,
    nose: faceLm[1] ? { ...faceLm[1], visibility: 0.97 } : null,
    lEye: faceLm[33] ? { ...faceLm[33], visibility: 0.97 } : null,
    rEye: faceLm[263] ? { ...faceLm[263], visibility: 0.97 } : null,
    lMouth: faceLm[61] ? { ...faceLm[61], visibility: 0.97 } : null,
    rMouth: faceLm[291] ? { ...faceLm[291], visibility: 0.97 } : null,
    lEar: faceLm[234] ? { ...faceLm[234], visibility: 0.97 } : null,
    rEar: faceLm[454] ? { ...faceLm[454], visibility: 0.97 } : null,
  };
  return { landmarks: next, fused: true, extras };
}

function sideSagittal(lm, aspect, world, face, ambiguous = false, facingHint = null) {
  const visProfile = pickProfile(lm);
  const collapsed = isHeadCollapsed(lm);
  const nose = (face && face.nose) || lm[I.NOSE];
  const guessEar = (face && (visProfile.side === "left" ? face.lEar : face.rEar)) || visProfile.ear;
  const inferredSign = inferForwardSign(nose, guessEar, visProfile.mouth, visProfile.eye);
  // A calibrated desktop camera has a fixed viewing direction. Re-inferring
  // it every frame lets a forward poke or noisy face point flip left/right,
  // which also swaps the shoulder anchor and reverses every displacement.
  const facing = facingHint === "left" || facingHint === "right"
    ? facingHint
    : inferredSign < 0 ? "left" : "right";
  const forwardSign = facing === "left" ? -1 : 1;

  // True side: the visible silhouette. 45°: the anatomical profile the camera
  // actually sees (look left → right ear/shoulder), not the near-camera chest.
  const reference = ambiguous
    ? chooseNeckAnchor(lm, face, facing, aspect, true)
    : {
        side: visProfile.side,
        idx: visProfile.idx,
        farIdx: visProfile.farIdx,
        ear: guessEar,
        earIdx: visProfile.idx.ear,
        shoulder: visProfile.shoulder,
        farShoulder: visProfile.farShoulder,
        shoulderIdx: visProfile.idx.sh,
        source: "profile",
        hip: visProfile.hip,
        hipIdx: visProfile.idx.hip,
        eye: visProfile.eye,
      };
  const ear = reference.ear;
  const shoulder = reference.shoulder;
  const farShoulder = reference.farShoulder;

  const neckH = Math.max(shoulder.y - ear.y, 0.04);
  const nearShX = sagX(shoulder, aspect);

  const chinSrc = (face && face.chin) || visProfile.mouth || blend([nose, ear], [0.65, 0.35]);
  const chin = {
    x: chinSrc.x,
    y: Math.max(chinSrc.y, ear.y + neckH * 0.22),
    z: chinSrc.z,
    visibility: vis(chinSrc),
  };

  const chest = {
    x: (shoulder.x + (farShoulder?.x || shoulder.x)) / 2,
    y: shoulder.y + neckH * 0.55,
    z: shoulder.z,
    visibility: vis(shoulder),
  };

  const earX = sagX(ear, aspect);
  const shX = nearShX;
  const noseX = sagX(nose, aspect);
  const chinX = sagX(chin, aspect);

  const neckRise = Math.max(shoulder.y - ear.y, 1e-4);
  const forward = (earX - shX) * forwardSign;
  // Ear to the shoulder under the head, from horizontal. 90° = stacked.
  const cva = clamp(deg(Math.atan2(neckRise, Math.max(forward, 0))), 15, 90);
  const earForward = ((earX - shX) * forwardSign) / neckRise;
  const chinForward = ((chinX - shX) * forwardSign) / neckRise;
  const chinPoke = ((noseX - earX) * forwardSign) / neckRise;
  const forwardRatio = forward / neckRise;

  let trunkAngle = 0;
  if (reference.hip) {
    const hipX = sagX(reference.hip, aspect);
    const trunkH = Math.max(reference.hip.y - shoulder.y, 0.08);
    const trunkFwd = (shX - hipX) * forwardSign;
    trunkAngle = deg(Math.atan2(trunkFwd, trunkH));
  }

  let worldEarForward = null;
  let worldChinForward = null;
  if (world && world[reference.earIdx] && world[reference.shoulderIdx]) {
    const we = world[reference.earIdx];
    const ws = world[reference.shoulderIdx];
    worldEarForward = (we.x - ws.x) * forwardSign;
    if (world[reference.idx.mouth]) {
      worldChinForward = (world[reference.idx.mouth].x - ws.x) * forwardSign;
    }
  }

  return {
    cva,
    forwardRatio,
    chinPoke,
    earForward,
    chinForward,
    worldEarForward,
    worldChinForward,
    trunkAngle,
    forward,
    rise: neckRise,
    facing,
    profileSide: reference.side,
    ear,
    eye: reference.eye,
    mouth: visProfile.mouth,
    chin,
    shoulder,
    farShoulder,
    shoulderSource: reference.source,
    shoulderIdx: reference.shoulderIdx,
    chest,
    hip: reference.hip,
    hipIdx: reference.hipIdx,
    nose,
    nearIdx: reference.idx,
    headCollapsed: collapsed,
  };
}

function worldPt(world, i, min = 0.16) {
  if (!world || !world[i] || vis(world[i]) < min) return null;
  return world[i];
}

function pairTilt(a, b, lat) {
  return deg(Math.atan2(a.y - b.y, Math.max(Math.abs(lat), 1e-4)));
}

function computeFrontal(lm, world, aspect, view) {
  const side = view === "side" || view === "oblique";
  const lEar = lm[I.L_EAR];
  const rEar = lm[I.R_EAR];
  const lSh = lm[I.L_SH];
  const rSh = lm[I.R_SH];
  const lHip = lm[I.L_HIP];
  const rHip = lm[I.R_HIP];
  const lEye = lm[I.L_EYE];
  const rEye = lm[I.R_EYE];

  let headTilt = 0;
  let tiltReady = false;
  let tiltSource = "none";
  const wLEar = worldPt(world, I.L_EAR);
  const wREar = worldPt(world, I.R_EAR);
  if (wLEar && wREar) {
    const lat = (wLEar.z || 0) - (wREar.z || 0);
    headTilt = pairTilt(wLEar, wREar, lat);
    tiltReady = (Math.abs(lat) > 0.03 || !side) && (!side || Math.abs(headTilt) < 28);
    tiltSource = "world";
  } else if (vis(lEar) > 0.26 && vis(rEar) > 0.26) {
    if (side) {
      const lat = (lEar.z || 0) - (rEar.z || 0);
      headTilt = pairTilt(lEar, rEar, lat);
      tiltReady = Math.abs(lat) > 0.018 || Math.abs(lEar.y - rEar.y) > 0.018;
    } else {
      headTilt = pairTilt(lEar, rEar, (lEar.x - rEar.x) * aspect);
      tiltReady = true;
    }
    tiltSource = "image";
  } else if (side) {
    const nearIsLeft = vis(lEar) >= vis(rEar);
    const ear = nearIsLeft ? lEar : rEar;
    const eye = nearIsLeft ? lEye : rEye;
    if (vis(ear) > 0.22 && vis(eye) > 0.2) {
      const roll = deg(Math.atan2(ear.y - eye.y, 0.07));
      headTilt = nearIsLeft ? roll : -roll;
      tiltReady = Math.abs(roll) > 0.5;
      tiltSource = "side-roll";
    }
  }

  let shoulderSlope = 0;
  let slopeReady = false;
  let slopeSource = "none";
  const wLSh = worldPt(world, I.L_SH);
  const wRSh = worldPt(world, I.R_SH);
  if (wLSh && wRSh) {
    const lat = (wLSh.z || 0) - (wRSh.z || 0);
    shoulderSlope = pairTilt(wLSh, wRSh, lat);
    const shImageSep = dist2(lSh, rSh);
    slopeReady =
      (Math.abs(lat) > 0.06 || !side) &&
      (!side || (Math.abs(shoulderSlope) < 22 && shImageSep < 0.16 && vis(lSh) >= 0.4 && vis(rSh) >= 0.4));
    slopeSource = "world";
  } else if (vis(lSh) > 0.22 && vis(rSh) > 0.22) {
    if (side) {
      const lat = (lSh.z || 0) - (rSh.z || 0);
      shoulderSlope = pairTilt(lSh, rSh, lat);
      slopeReady = Math.abs(lat) > 0.02 || Math.abs(lSh.y - rSh.y) > 0.016;
    } else {
      shoulderSlope = pairTilt(lSh, rSh, (lSh.x - rSh.x) * aspect);
      slopeReady = true;
    }
    slopeSource = "image";
  }

  let lean = 0;
  let leanReady = false;
  let leanSource = "none";
  const wLHip = worldPt(world, I.L_HIP, 0.12);
  const wRHip = worldPt(world, I.R_HIP, 0.12);
  if (wLSh && wRSh && (wLHip || wRHip)) {
    const shz = ((wLSh.z || 0) + (wRSh.z || 0)) / 2;
    const shy = (wLSh.y + wRSh.y) / 2;
    const hipz = wLHip && wRHip ? ((wLHip.z || 0) + (wRHip.z || 0)) / 2 : (wLHip || wRHip).z || 0;
    const hipy = wLHip && wRHip ? (wLHip.y + wRHip.y) / 2 : (wLHip || wRHip).y;
    if (side) {
      lean = deg(Math.atan2(shz - hipz, Math.abs(hipy - shy) + 1e-4));
    } else {
      const shx = (wLSh.x + wRSh.x) / 2;
      const hipx = wLHip && wRHip ? (wLHip.x + wRHip.x) / 2 : (wLHip || wRHip).x;
      lean = deg(Math.atan2(shx - hipx, Math.abs(hipy - shy) + 1e-4));
    }
    leanReady = true;
    leanSource = "world";
  } else if (vis(lSh) > 0.22 && vis(rSh) > 0.22 && vis(lHip) + vis(rHip) > 0.28) {
    const sh = mid(lSh, rSh);
    const hip = vis(lHip) > 0.2 && vis(rHip) > 0.2 ? mid(lHip, rHip) : vis(lHip) > vis(rHip) ? lHip : rHip;
    if (side) {
      lean = deg(Math.atan2((sh.z || 0) - (hip.z || 0), Math.abs(hip.y - sh.y) + 1e-4));
      leanReady = Math.abs((sh.z || 0) - (hip.z || 0)) > 0.015;
    } else {
      lean = deg(Math.atan2((sh.x - hip.x) * aspect, Math.abs(hip.y - sh.y) + 1e-4));
      leanReady = true;
    }
    leanSource = "image";
  }

  return { headTilt, shoulderSlope, lean, tiltReady, slopeReady, leanReady, tiltSource, slopeSource, leanSource };
}

export function extractMetrics(lm, opts = {}) {
  const aspect = opts.aspect > 0.3 ? opts.aspect : 16 / 9;
  const classified = classifyView(lm, aspect);
  const forced = opts.viewHint;
  const view = forced === "side" || forced === "front" ? forced : classified.view === "front" ? "front" : "side";

  const nose = lm[I.NOSE];
  const lEar = lm[I.L_EAR];
  const rEar = lm[I.R_EAR];
  const lSh = lm[I.L_SH];
  const rSh = lm[I.R_SH];
  const lHip = lm[I.L_HIP];
  const rHip = lm[I.R_HIP];
  const hipsOk = vis(lHip) > 0.25 && vis(rHip) > 0.25;

  const sag = sideSagittal(lm, aspect, opts.world, opts.face, classified.view !== "side", opts.facingHint);

  const earMid = mid(lEar, rEar);
  const shoulderMid = mid(lSh, rSh);
  const hipMid = mid(lHip, rHip);
  const shoulderWidth = dist2(lSh, rSh);
  const faceScale = Math.max(dist2(lEar, rEar), 0.04);

  const frontal = computeFrontal(lm, opts.world, aspect, view);
  const headTilt = frontal.headTilt;
  const shoulderSlope = frontal.shoulderSlope;
  const lean = frontal.lean;
  const shoulderProtract = hipsOk ? hipMid.z - shoulderMid.z : 0;
  const widthRatio = shoulderWidth / faceScale;
  const headForwardDepth = shoulderMid.z - earMid.z;

  const ear = view === "front" ? earMid : sag.ear;
  const shoulder = view === "front" ? shoulderMid : sag.shoulder;

  return {
    view,
    classified: classified.view,
    sideScore: classified.sideScore,
    facing: sag.facing,
    profileSide: sag.profileSide,
    nearIdx: sag.nearIdx,
    shoulderSource: sag.shoulderSource,
    shoulderIdx: sag.shoulderIdx,
    cva: sag.cva,
    forwardRatio: sag.forwardRatio,
    chinPoke: sag.chinPoke,
    earForward: sag.earForward,
    chinForward: sag.chinForward,
    worldEarForward: sag.worldEarForward,
    worldChinForward: sag.worldChinForward,
    trunkAngle: sag.trunkAngle,
    craniovertebral: sag.cva,
    neckFromVertical: 90 - sag.cva,
    headForwardDepth,
    headTilt,
    shoulderSlope,
    lean,
    tiltReady: frontal.tiltReady,
    slopeReady: frontal.slopeReady,
    leanReady: frontal.leanReady,
    tiltSource: frontal.tiltSource,
    slopeSource: frontal.slopeSource,
    leanSource: frontal.leanSource,
    shoulderProtract,
    widthRatio,
    shoulderWidth,
    faceScale,
    hipsOk,
    ear,
    eye: sag.eye,
    mouth: sag.mouth,
    chin: sag.chin,
    shoulder,
    farShoulder: sag.farShoulder,
    headCollapsed: sag.headCollapsed,
    chest: sag.chest,
    hip: sag.hip || (hipsOk ? hipMid : null),
    nose,
    lSh,
    rSh,
    lEar,
    rEar,
  };
}

export function captureBaseline(lm, opts = {}) {
  const m = extractMetrics(lm, opts);
  return {
    capturedAt: Date.now(),
    view: m.view,
    facing: m.facing,
    cva: m.cva,
    craniovertebral: m.cva,
    forwardRatio: m.forwardRatio,
    chinPoke: m.chinPoke,
    earForward: m.earForward,
    chinForward: m.chinForward,
    worldEarForward: m.worldEarForward,
    trunkAngle: m.trunkAngle,
    neckFromVertical: m.neckFromVertical,
    headForwardDepth: m.headForwardDepth,
    widthRatio: m.widthRatio,
    shoulderProtract: m.shoulderProtract,
    headTilt: m.tiltReady && Math.abs(m.headTilt) < 18 ? m.headTilt : null,
    shoulderSlope: m.slopeReady && Math.abs(m.shoulderSlope) < 18 ? m.shoulderSlope : null,
    lean: m.leanReady && Math.abs(m.lean) < 18 ? m.lean : null,
    headCollapsed: m.headCollapsed,
  };
}

function issue(id, severity, value, detail) {
  return { id, name: CHECKS[id].name, fix: CHECKS[id].fix, hint: CHECKS[id].hint, severity, value, detail };
}

function worse(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.severity === "alert") return a;
  if (b.severity === "alert") return b;
  return a;
}

function baselineMetric(baseline, ...keys) {
  for (const key of keys) {
    const value = baseline?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function decideForwardHead(m, baseline, k, algo) {
  let hit = null;
  const ambiguous = m.classified !== "side";
  const absWarn = algo.cvaWarn + (1 - k.angle) * 8;
  const absAlert = algo.cvaAlert + (1 - k.angle) * 6;
  let cvaWarn = absWarn;
  let cvaAlert = absAlert;

  const baseCva = baselineMetric(baseline, "cva", "craniovertebral");
  if (baseCva != null && ambiguous) {
    // A forced side view is often actually a 3/4 view. In that case the
    // absolute ear–shoulder angle is biased by camera angle, so judge the drop
    // from the user's calibrated neutral pose instead of requiring < 50°.
    cvaWarn = Math.max(absWarn, baseCva - 10 * k.drop);
    cvaAlert = Math.max(absAlert, baseCva - 18 * k.drop);
  } else if (baseline && (baseline.view === "side" || baseline.view === "oblique") && baseCva != null) {
    cvaWarn = Math.min(baseCva - 4 * k.drop, absWarn + 2);
    cvaAlert = Math.min(baseCva - 8 * k.drop, absAlert + 2);
  }

  const cva = m.cva;
  // 45° frames cannot use an absolute "CVA < 50°" gate: the camera already
  // shears ear vs acromion. Only judge the drop from calibration there.
  if (!ambiguous && cva < algo.cvaHardAlert) hit = worse(hit, { severity: "alert", detail: `耳–肩角 ${cva.toFixed(0)}°` });
  else if (!ambiguous || baseCva != null) {
    if (cva <= cvaAlert) hit = worse(hit, { severity: "alert", detail: `耳–肩角 ${cva.toFixed(0)}°` });
    else if (cva <= cvaWarn) hit = worse(hit, { severity: "warn", detail: `耳–肩角 ${cva.toFixed(0)}°` });
  }

  let earWarn = algo.earFwdWarn * k.depth;
  let earAlert = algo.earFwdAlert * k.depth;
  const baseEar = baselineMetric(baseline, "earForward");
  const earDelta = baseEar == null ? null : m.earForward - baseEar;
  // earForward is signed by the detected facing direction. In a 3/4 frame a
  // perfectly usable neutral value can therefore be negative (for example
  // -0.9). Comparing that value with the positive absolute threshold makes
  // calibrated forward motion impossible to detect. Once calibrated, judge
  // the signed displacement from the user's own neutral pose instead.
  const relativeEarWarn = (ambiguous ? 0.1 : 0.12) * k.drop;
  const relativeEarAlert = (ambiguous ? 0.2 : 0.24) * k.drop;
  const earAlerted = earDelta == null ? m.earForward > earAlert : earDelta > relativeEarAlert;
  const earWarned = earDelta == null ? m.earForward > earWarn : earDelta > relativeEarWarn;
  if (earAlerted) hit = worse(hit, { severity: "alert", detail: `耳已离开标准肩位` });
  else if (earWarned) hit = worse(hit, { severity: "warn", detail: `耳相对标准姿势前移` });

  let chinWarn = algo.chinFwdWarn * k.depth;
  let chinAlert = algo.chinFwdAlert * k.depth;
  const baseChin = baselineMetric(baseline, "chinForward");
  const chinDelta = baseChin == null ? null : m.chinForward - baseChin;
  // A 3/4 capture naturally moves the projected chin by roughly 0.13 while
  // breathing or resettling. Live calibrated captures put a deliberate neck
  // poke above 0.26, leaving a stable deadband between the two populations.
  const relativeChinWarn = (ambiguous ? 0.16 : 0.12) * k.drop;
  const relativeChinAlert = 0.24 * k.drop;
  const chinAlerted = chinDelta == null ? m.chinForward > chinAlert : chinDelta > relativeChinAlert;
  const chinWarned = chinDelta == null ? m.chinForward > chinWarn : chinDelta > relativeChinWarn;
  // Face Landmarker's chin/mouth anchor is substantially steadier than the
  // pose ear in a forced side view. A calibrated relative chin displacement
  // is therefore valid evidence by itself; only the uncalibrated absolute
  // chin path still needs ear/CVA corroboration.
  const chinSupported =
    chinDelta != null
      ? chinWarned
      : earWarned || (earDelta != null && earDelta > relativeEarWarn * 0.55) || cva < absWarn + 6;
  if (chinSupported && chinAlerted) hit = worse(hit, { severity: "alert", detail: `下颌明显前伸` });
  else if (chinSupported && chinWarned) hit = worse(hit, { severity: "warn", detail: `下颌前伸` });

  if (m.worldEarForward != null) {
    const baseWorld = baselineMetric(baseline, "worldEarForward");
    const worldDelta = baseWorld == null ? null : m.worldEarForward - baseWorld;
    // Absolute world-Z displacement is not trustworthy in a front/oblique
    // frame: the standard pose in that frame can already be ~20 cm away from
    // the selected shoulder. Without a baseline, ignore it in that view.
    const useRelativeWorld = ambiguous && worldDelta != null;
    const useWorld = !ambiguous || useRelativeWorld;
    if (useWorld) {
      const value = useRelativeWorld ? worldDelta : m.worldEarForward;
      const wWarn = useRelativeWorld
        ? Math.max(algo.worldFwdWarn * 0.75, 0.04)
        : algo.worldFwdWarn * k.depth;
      const wAlert = useRelativeWorld
        ? Math.max(algo.worldFwdAlert * 0.75, 0.08)
        : algo.worldFwdAlert * k.depth;
      const cm = Math.round(value * 100);
      const detail = useRelativeWorld ? `相对基准头前伸约 ${cm}cm` : `头前伸约 ${cm}cm`;
      if (value > wAlert) hit = worse(hit, { severity: "alert", detail });
      else if (value > wWarn) hit = worse(hit, { severity: "warn", detail });
    }
  }

  if (ambiguous) {
    const baseDepth = baselineMetric(baseline, "headForwardDepth");
    if (baseDepth != null && Number.isFinite(m.headForwardDepth)) {
      const depthDelta = m.headForwardDepth - baseDepth;
      // MediaPipe depth is noisy when a front/3/4 frame is forced through the
      // side-view workflow. It may even reverse when the torso rotates. Never
      // let depth alone create the forward-head issue; require matching 2D
      // head displacement from the calibrated ear/chin anchors.
      const depthCorroborated =
        (earDelta != null && earDelta > relativeEarWarn) ||
        (chinDelta != null && chinDelta > relativeChinWarn);
      if (depthCorroborated && depthDelta > 0.12) hit = worse(hit, { severity: "alert", detail: "头相对标准姿势明显前移" });
      else if (depthCorroborated && depthDelta > 0.07) hit = worse(hit, { severity: "warn", detail: "头相对标准姿势前移" });
    }
  }

  if (m.chinPoke > algo.pokeWarn && cva < algo.pokeCva) {
    hit = worse(hit, { severity: "warn", detail: `下颌前探 · 耳–肩角 ${cva.toFixed(0)}°` });
  }

  return hit;
}

function decideFrontForwardHead(m, baseline, k, settings) {
  const algo = algoOf(settings);
  const depthLimit = (baseline && typeof baseline.headForwardDepth === "number"
    ? baseline.headForwardDepth + 0.06
    : 0.1) * k.depth;
  const depthBad = m.headForwardDepth > depthLimit;
  const earBad = m.earForward > algo.earFwdWarn * k.depth * 1.15;
  const worldBad = m.worldEarForward != null && m.worldEarForward > algo.worldFwdWarn * k.depth;

  if (depthBad && (earBad || m.cva < 50 * (2 - k.angle))) {
    return {
      severity: m.headForwardDepth > depthLimit * 1.4 || m.cva < 40 ? "alert" : "warn",
      detail: `耳–肩角约 ${m.cva.toFixed(0)}°`,
    };
  }
  if (worldBad && earBad) {
    return { severity: "warn", detail: `头相对肩前伸` };
  }
  if (m.headForwardDepth > depthLimit * 1.5) {
    return { severity: "alert", detail: `头相对肩前伸` };
  }
  return decideForwardHead(m, baseline, k, algo);
}

function emaToward(prev, next, up, down) {
  if (prev == null || !Number.isFinite(prev)) return next;
  if (!Number.isFinite(next)) return prev;
  const a = next < prev ? down : up;
  return prev * (1 - a) + next * a;
}

export function analyze(lm, baseline, settings, opts = {}) {
  const enabled = settings.checks || {};
  const k = SENSITIVITY[settings.sensitivity] || SENSITIVITY.standard;
  const algo = algoOf(settings);
  const viewHint = settings.viewMode === "auto" ? null : settings.viewMode;
  const m = extractMetrics(lm, {
    ...opts,
    viewHint: viewHint || opts.viewHint,
    facingHint: baseline?.facing || opts.facingHint,
  });
  if (opts.smoothState) {
    const up = algo.smoothAlpha;
    const down = algo.smoothAlphaDown || 0.48;
    const s = opts.smoothState;
    s.cva = emaToward(s.cva, m.cva, up, down);
    s.fwd = emaToward(s.fwd, m.forwardRatio, down, up);
    s.earFwd = emaToward(s.earFwd, m.earForward, down, up);
    s.chinFwd = emaToward(s.chinFwd, m.chinForward, down, up);
    if (m.worldEarForward != null) s.worldFwd = emaToward(s.worldFwd, m.worldEarForward, down, up);
    s.tilt = emaToward(s.tilt, m.headTilt, up, up);
    s.slope = emaToward(s.slope, m.shoulderSlope, up, up);
    s.lean = emaToward(s.lean, m.lean, up, up);
    m.cva = s.cva;
    m.craniovertebral = s.cva;
    m.forwardRatio = s.fwd;
    m.earForward = s.earFwd;
    m.chinForward = s.chinFwd;
    if (s.worldFwd != null) m.worldEarForward = s.worldFwd;
    m.headTilt = s.tilt;
    m.shoulderSlope = s.slope;
    m.lean = s.lean;
    m.neckFromVertical = 90 - s.cva;
  }
  const issues = [];
  const sideLike = m.view === "side" || m.view === "oblique" || settings.viewMode === "side";

  if (enabled.forwardHead !== false) {
    let hit = sideLike ? decideForwardHead(m, baseline, k, algo) : decideFrontForwardHead(m, baseline, k, settings);
    if (opts.smoothState) {
      const now = Date.now();
      if (hit) {
        opts.smoothState.forwardHeadLatch = { until: now + algo.forwardHoldMs, hit: { ...hit } };
      } else if (opts.smoothState.forwardHeadLatch?.until > now) {
        // Do not flicker back to good because one face/ear frame straddled the
        // calibrated threshold. The alert clears shortly after a real return
        // to neutral, while the UI's existing hold timer handles escalation.
        hit = { ...opts.smoothState.forwardHeadLatch.hit };
      } else {
        delete opts.smoothState.forwardHeadLatch;
      }
    }
    if (hit) issues.push(issue("forwardHead", hit.severity, Math.round(m.cva), hit.detail));
  }

  if (enabled.slouch !== false) {
    if (sideLike) {
      const trunkWarn = algo.trunkWarn * k.angle;
      const trunkAlert = algo.trunkAlert * k.angle;
      if (m.trunkAngle > trunkAlert) {
        issues.push(issue("slouch", "alert", Math.round(m.trunkAngle), `躯干前倾 ${m.trunkAngle.toFixed(0)}°`));
      } else if (m.trunkAngle > trunkWarn) {
        issues.push(issue("slouch", "warn", Math.round(m.trunkAngle), `躯干前倾 ${m.trunkAngle.toFixed(0)}°`));
      }
    } else {
      const protractLimit = (baseline ? baseline.shoulderProtract + 0.08 : 0.11) * k.depth;
      const widthFloor = (baseline ? baseline.widthRatio * 0.78 : 1.55) / k.depth;
      const protractBad = m.shoulderProtract > protractLimit;
      const narrow = m.widthRatio < widthFloor;
      if (protractBad || (narrow && m.hipsOk)) {
        issues.push(issue("slouch", protractBad && narrow ? "alert" : "warn", Math.round(m.widthRatio * 10) / 10, "肩带前移、胸廓闭合"));
      }
    }
  }

  const useWorldTilt = m.tiltSource === "world";
  const tiltLimit = (sideLike && !useWorldTilt ? algo.tiltLimitSide : algo.tiltLimit) * k.angle;
  const slopeLimit = (sideLike && m.slopeSource !== "world" ? algo.slopeLimitSide : algo.slopeLimit) * k.angle;
  const leanLimit = (sideLike && m.leanSource !== "world" ? algo.leanLimitSide : algo.leanLimit) * k.angle;
  const usableBaseTilt = baseline && typeof baseline.headTilt === "number" && Math.abs(baseline.headTilt) < 18;
  const usableBaseSlope = baseline && typeof baseline.shoulderSlope === "number" && Math.abs(baseline.shoulderSlope) < 18;
  const usableBaseLean = baseline && typeof baseline.lean === "number" && Math.abs(baseline.lean) < 18;
  const tiltVal = usableBaseTilt ? m.headTilt - baseline.headTilt : m.headTilt;
  const slopeVal = usableBaseSlope ? m.shoulderSlope - baseline.shoulderSlope : m.shoulderSlope;
  const leanVal = usableBaseLean ? m.lean - baseline.lean : m.lean;

  if (enabled.headTilt !== false && m.tiltReady && Math.abs(tiltVal) > tiltLimit) {
    issues.push(
      issue(
        "headTilt",
        Math.abs(tiltVal) > tiltLimit * 1.6 ? "alert" : "warn",
        Math.round(Math.abs(tiltVal)),
        `${tiltVal > 0 ? "左" : "右"}倾 ${Math.abs(tiltVal).toFixed(0)}°`
      )
    );
  }
  if (enabled.unevenShoulders !== false && m.slopeReady && Math.abs(slopeVal) > slopeLimit) {
    issues.push(
      issue(
        "unevenShoulders",
        Math.abs(slopeVal) > slopeLimit * 1.6 ? "alert" : "warn",
        Math.round(Math.abs(slopeVal)),
        `${slopeVal > 0 ? "左肩偏低" : "右肩偏低"} ${Math.abs(slopeVal).toFixed(0)}°`
      )
    );
  }
  if (enabled.lean !== false && m.leanReady && Math.abs(leanVal) > leanLimit) {
    const dir = sideLike ? (leanVal > 0 ? "远离镜头" : "靠向镜头") : leanVal > 0 ? "右" : "左";
    issues.push(
      issue(
        "lean",
        Math.abs(leanVal) > leanLimit * 1.55 ? "alert" : "warn",
        Math.round(Math.abs(leanVal)),
        `躯干${sideLike ? dir : `向${dir}偏`} ${Math.abs(leanVal).toFixed(0)}°`
      )
    );
  }

  let score = 100;
  for (const it of issues) score -= it.severity === "alert" ? 22 : 12;
  score = clamp(Math.round(score), 0, 100);
  const worst = issues.some((i) => i.severity === "alert") ? "alert" : issues.length ? "warn" : "good";

  return { metrics: m, issues, score, status: worst };
}

export function smoothLandmarks(prev, next, alpha = 0.28) {
  if (!next) return prev;
  if (!prev) return next.map((p) => ({ ...p }));
  return next.map((p, i) => {
    const q = prev[i] || p;
    const visNow = typeof p.visibility === "number" ? p.visibility : 1;
    const a = clamp(alpha * (0.55 + visNow * 0.7), 0.12, 0.7);
    return {
      x: q.x + (p.x - q.x) * a,
      y: q.y + (p.y - q.y) * a,
      z: (q.z || 0) + ((p.z || 0) - (q.z || 0)) * a,
      visibility: p.visibility,
    };
  });
}
