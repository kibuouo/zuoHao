import { PoseLandmarker, FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";
import { analyze, captureBaseline, fuseFaceIntoPose, isUpperBodyVisible, smoothLandmarks } from "./analyze.js";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_HEAVY =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task";
const MODEL_FULL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
const MODEL_LITE =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const MODEL_FACE =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this.faceLandmarker = null;
    this.faceExtras = null;
    this.stream = null;
    this.video = null;
    this.running = false;
    this.raf = 0;
    this.lastVideoTime = -1;
    this.smoothed = null;
    this.smoothedWorld = null;
    this.baseline = null;
    this.settings = null;
    this.onFrame = null;
    this.onError = null;
    this.cameraId = null;
    this.smoothState = null;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const options = {
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.32,
      minPosePresenceConfidence: 0.28,
      minTrackingConfidence: 0.28,
    };
    const delegates = ["GPU", "CPU"];
    const models = [MODEL_HEAVY, MODEL_FULL, MODEL_LITE];
    let lastErr = null;
    for (const model of models) {
      for (const delegate of delegates) {
        try {
          this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: model, delegate },
          });
          this.initFace(fileset, delegate).catch(() => {});
          return;
        } catch (err) {
          lastErr = err;
        }
      }
    }
    throw lastErr || new Error("姿态模型加载失败");
  }

  async initFace(fileset, delegate) {
    if (this.faceLandmarker) return;
    const vision = fileset || (await FilesetResolver.forVisionTasks(WASM));
    const tries = [delegate, "GPU", "CPU"].filter((d, i, arr) => d && arr.indexOf(d) === i);
    for (const d of tries) {
      try {
        this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.35,
          minFacePresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
          baseOptions: { modelAssetPath: MODEL_FACE, delegate: d },
        });
        return;
      } catch {
        /* try next delegate */
      }
    }
  }

  async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  async start(videoEl, { cameraId, settings, baseline, onFrame, onError } = {}) {
    this.video = videoEl;
    this.settings = settings;
    this.baseline = baseline || null;
    this.onFrame = onFrame;
    this.onError = onError;
    this.cameraId = cameraId || null;

    if (!this.landmarker) await this.init();
    await this.openCamera(cameraId);
    this.running = true;
    this.loop();
  }

  async openCamera(cameraId) {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    const side = this.settings?.viewMode !== "front";
    const constraints = {
      audio: false,
      video: {
        deviceId: cameraId ? { exact: cameraId } : undefined,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        facingMode: cameraId || side ? undefined : "user",
      },
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (cameraId) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } else {
        throw err;
      }
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this.lastVideoTime = -1;
  }

  async switchCamera(cameraId) {
    this.cameraId = cameraId;
    await this.openCamera(cameraId);
  }

  setSettings(settings) {
    this.settings = settings;
  }

  setBaseline(baseline) {
    this.baseline = baseline;
  }

  videoAspect() {
    const w = this.video?.videoWidth || 16;
    const h = this.video?.videoHeight || 9;
    return w / Math.max(h, 1);
  }

  calibrate() {
    if (!this.smoothed || !isUpperBodyVisible(this.smoothed)) {
      throw new Error("还看不到头和靠近镜头的肩膀。侧对镜头，让耳朵、脖子、近侧肩膀入画后再校准");
    }
    this.baseline = captureBaseline(this.smoothed, {
      aspect: this.videoAspect(),
      world: this.smoothedWorld,
    });
    this.smoothState = {
      cva: this.baseline.cva,
      fwd: this.baseline.forwardRatio,
      earFwd: this.baseline.earForward,
      chinFwd: this.baseline.chinForward,
      worldFwd: this.baseline.worldEarForward,
    };
    return this.baseline;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.smoothed = null;
    this.smoothedWorld = null;
    this.smoothState = null;
    this.faceExtras = null;
  }

  loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const video = this.video;
    if (!video || video.readyState < 2) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    try {
      const now = performance.now();
      const result = this.landmarker.detectForVideo(video, now);
      let raw = result.landmarks && result.landmarks[0];
      const rawWorld = result.worldLandmarks && result.worldLandmarks[0];
      this.faceExtras = null;
      if (raw && this.faceLandmarker) {
        try {
          const faces = this.faceLandmarker.detectForVideo(video, now);
          const face = faces?.faceLandmarks && faces.faceLandmarks[0];
          if (face) {
            const fused = fuseFaceIntoPose(raw, face);
            raw = fused.landmarks;
            this.faceExtras = fused.extras;
          }
        } catch {
          /* keep pose-only */
        }
      }
      const present = !!(raw && isUpperBodyVisible(raw));
      const sideLike = this.settings?.viewMode !== "front";
      const algo = this.settings?.algorithm || {};
      const alpha = sideLike ? algo.landmarkAlphaSide || 0.34 : algo.landmarkAlphaFront || 0.38;
      this.smoothed = present ? smoothLandmarks(this.smoothed, raw, alpha) : null;
      this.smoothedWorld = present && rawWorld ? smoothLandmarks(this.smoothedWorld, rawWorld, alpha) : null;
      if (!present) this.smoothState = null;
      else if (!this.smoothState) this.smoothState = {};
      const analysis = this.smoothed
        ? analyze(this.smoothed, this.baseline, this.settings || {}, {
            aspect: this.videoAspect(),
            smoothState: this.smoothState,
            world: this.smoothedWorld,
            face: this.faceExtras,
          })
        : null;
      if (this.onFrame) {
        this.onFrame({
          present,
          landmarks: this.smoothed,
          world: this.smoothedWorld,
          face: this.faceExtras,
          analysis,
        });
      }
    } catch (err) {
      if (this.onError) this.onError(err);
    }
  };
}
