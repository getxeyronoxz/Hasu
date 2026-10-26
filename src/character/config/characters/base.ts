/**
 * Base character look.
 *
 * The source pack ships without a bundled 3D model (see README: the models
 * used during development may not be redistributed). This config holds the
 * model-independent half of a CharacterConfig - lighting, shading, camera
 * feel, physics, idle timing and lip sync - which every imported character
 * inherits via `configFromProfile`. The model-specific half (bones, morphs,
 * material roles, scale, model URL) always comes from the imported profile.
 *
 * Light levels are calibrated against the engine's own shader defaults in
 * materials/AnimeMaterial.ts (body levels are relative to the key light; face
 * levels are absolute), so the result matches the renderer's tuned baseline.
 */
import type { CharacterConfig } from '../types';

const KEY_INTENSITY = 3.0;

export const baseCharacterConfig: CharacterConfig = {
  id: 'base',
  displayName: 'Base',
  // No model: these are always overridden by the imported profile.
  modelUrl: '',
  textureMapUrl: '',
  // Imported models are normalised to ~20 units tall by the importer.
  scale: 1,
  groundOffset: 0,

  bones: {
    root: '全ての親',
    center: 'センター',
    groove: 'グルーブ',
    waist: '腰',
    lowerBody: '下半身',
    upperBody: '上半身',
    upperBody2: '上半身2',
    neck: '首',
    head: '頭',
    eyes: '両目',
    eyeL: '左目',
    eyeR: '右目',
    shoulderL: '左肩',
    shoulderR: '右肩',
    armL: '左腕',
    armR: '右腕',
    elbowL: '左ひじ',
    elbowR: '右ひじ',
    wristL: '左手首',
    wristR: '右手首',
    legL: '左足',
    legR: '右足',
    kneeL: '左ひざ',
    kneeR: '右ひざ',
    ankleL: '左足首',
    ankleR: '右足首',
  },
  basePose: undefined,
  outline: { enabled: false, scale: 1 },
  morphs: {},
  materialRoles: {},

  materialTuning: {
    skin: {
      shadowTint: 0xf2c4bc,
      lightTint: 0xffffff,
      subsurfaceStrength: 0.25,
      subsurfaceColor: 0xff9a84,
      warmth: 0.08,
      warmColor: 0xffd9c7,
      specularStrength: 0.04,
      rimWhiteness: 0.3,
      minLight: 0.32,
    },
    face: {
      lightingRig: 'face',
      shadowTint: 0xf4cbc3,
      lightTint: 0xffffff,
      shadowReceive: 0.55,
      subsurfaceStrength: 0.22,
      subsurfaceColor: 0xff9a84,
      warmth: 0.06,
      warmColor: 0xffd9c7,
      specularStrength: 0.02,
      minLight: 0.62,
    },
    eyeWhite: { lightingRig: 'face', shadowReceive: 0.45, minLight: 0.7, specularStrength: 0 },
    iris: {
      lightingRig: 'face',
      shadowReceive: 0.4,
      brightness: 0.92,
      eyeReflectionStrength: 0.6,
      minLight: 0.55,
    },
    catchlight: { blend: 'blend', unlit: true },
    eyeShadow: { blend: 'blend', lightingRig: 'face' },
    lash: { lightingRig: 'face', alphaTest: 0.01, specularStrength: 0 },
    brow: { lightingRig: 'face', alphaTest: 0.01, specularStrength: 0 },
    mouth: { lightingRig: 'face', shadowReceive: 0.6 },
    teeth: { lightingRig: 'face', shadowReceive: 0.6, specularStrength: 0 },
    tongue: { lightingRig: 'face', shadowReceive: 0.6 },
    hair: {
      shadowTint: 0xb9b2d6,
      anisotropicStrength: 0.35,
      anisotropicShift: 0.1,
      specularWhiteness: 0.45,
      viewTopStrength: 0.4,
      localContrast: 0.15,
    },
    frontHair: {
      shadowTint: 0xc2bbdc,
      anisotropicStrength: 0.35,
      anisotropicShift: 0.1,
      specularWhiteness: 0.45,
      viewKeyStrength: 0.35,
      viewTopStrength: 0.4,
    },
    lightCloth: { shadowTint: 0xc9cfe6, specularWhiteness: 0.15, rimWhiteness: 0.3 },
    cloth: { shadowTint: 0xb8bcd4, specularWhiteness: 0.1, rimWhiteness: 0.2, localContrast: 0.12 },
    leather: { shadowTint: 0xb0aac0, specularStrength: 0.18, specularPower: 32, specularWhiteness: 0.4 },
    metal: { specularStrength: 0.45, specularPower: 48, specularWhiteness: 0.9, rimWhiteness: 0.8, sphereStrength: 0.8 },
    jewelry: { specularStrength: 0.5, specularPower: 64, specularWhiteness: 0.95, rimWhiteness: 0.85, sphereStrength: 0.9 },
    accessory: { shadowTint: 0xbcbfd6, specularWhiteness: 0.3 },
  },

  camera: {
    targetBone: '上半身2',
    targetOffset: 0.6,
    distance: 24,
    fov: 30,
    heightOffset: 0.8,
    parallax: 0.035,
    minDistance: 7,
    maxDistance: 42,
  },

  lighting: {
    keyIntensity: KEY_INTENSITY,
    keyColor: 0xfff1e2,
    keyAzimuth: 32,
    keyElevation: 36,
    fillIntensity: KEY_INTENSITY * 0.2,
    fillColor: 0xdfe7ff,
    fillAzimuth: -58,
    fillElevation: 12,
    rimIntensity: KEY_INTENSITY * 0.14,
    rimColor: 0xeef3ff,
    rimAzimuth: 160,
    rimElevation: 28,
    hairLightIntensity: KEY_INTENSITY * 0.1,
    hairLightColor: 0xfff6ee,
    frontFillIntensity: KEY_INTENSITY * 0.22,
    frontFillColor: 0xfff8f2,
    face: {
      // Matches the shader's default face key direction (-0.36, 0.31, 0.88).
      keyAzimuth: 22,
      keyElevation: 18,
      keyIntensity: 0.62,
      keyColor: 0xfff4ea,
      fillIntensity: 0.4,
      fillColor: 0xf6f4ff,
      topIntensity: 0.18,
      topColor: 0xffffff,
      rimIntensity: 0.16,
      rimColor: 0xeef3ff,
      bounceIntensity: 0.2,
      bounceColor: 0xffe6da,
    },
    ambientIntensity: KEY_INTENSITY * 0.15,
    ambientSkyColor: 0xe2e9ff,
    ambientGroundColor: 0xf4e0d2,
    environmentIntensity: 0.35,
    shadow: {
      enabled: true,
      mapSize: 2048,
      radius: 4,
      bias: -0.0004,
      normalBias: 0.03,
      opacity: 0.55,
    },
  },

  render: {
    exposure: 1.0,
    toneMapping: 'neutral',
    bloom: { enabled: false, strength: 0.18, radius: 0.4, threshold: 0.92 },
    antialias: true,
    maxPixelRatio: 2,
    targetFps: 60,
  },

  physics: {
    frequency: 60,
    maxSubSteps: 4,
    gravity: 9.8,
    globalAmplitude: 1,
    groups: {
      hair: { match: ['髪', 'hair', 'Hair'], amplitude: 0.7, stiffness: 0.16, damping: 0.22, restPull: 0.28, maxAngleDeg: 18 },
      skirt: { match: ['スカート', 'skirt', 'Skirt'], amplitude: 0.55, stiffness: 0.2, damping: 0.28, restPull: 0.35, maxAngleDeg: 14 },
      bust: { match: ['胸', 'bust', 'Bust', 'breast'], amplitude: 0.35, stiffness: 0.3, damping: 0.35, restPull: 0.5, maxAngleDeg: 6, gravityScale: 0.4 },
      ribbon: { match: ['リボン', 'ribbon', 'Ribbon', 'タイ', 'tie'], amplitude: 0.75, stiffness: 0.14, damping: 0.2, restPull: 0.22, maxAngleDeg: 22 },
    },
    fallback: { match: [], amplitude: 0.6, stiffness: 0.18, damping: 0.25, restPull: 0.3, maxAngleDeg: 15 },
  },

  idle: {
    // Cycles per second (breathCurve is periodic over a 0..1 phase).
    breathRate: 0.24,
    breathDepth: 1,
    swayRate: 0.07,
    swayAmount: 1,
    postureIntervalMin: 7,
    postureIntervalMax: 16,
    blinkIntervalMin: 2.2,
    blinkIntervalMax: 6,
    doubleBlinkChance: 0.18,
    saccadeIntervalMin: 0.8,
    saccadeIntervalMax: 3.2,
  },

  behaviour: {
    intervalMin: 9,
    intervalMax: 22,
    noRepeatWindow: 3,
    busyIntervalScale: 2.5,
  },

  lipSync: {
    // Per-frame rates at 60 fps; LipSync converts them to frame-rate independent blends.
    attack: 0.45,
    release: 0.2,
    gain: 1.6,
    noiseFloor: 0.04,
    maxWeight: 0.85,
    visemeBlendRate: 0.3,
  },

  hiddenMaterials: [],
};
