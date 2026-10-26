/**
 * VRM / GLB / glTF → PMX converter.
 *
 * The renderer, the skeleton analyser and the physics/face controllers are all
 * built around PMX (MMD) data, so other formats are converted into a PMX at
 * import time and then follow exactly the same pipeline as a native PMX:
 *
 *   glTF node tree      → PMX bones (humanoid bones renamed to VRoid-style names
 *                         the humanoid mapper already knows, others keep their name)
 *   skinned primitives  → PMX vertices with BDEF1/2/4 weights, rest pose baked
 *   VRM expressions     → PMX vertex morphs named like MMD's standard morphs
 *   glTF morph targets  → PMX vertex morphs keeping the target name (ARKit, Fcl_*)
 *   materials/images    → PMX materials + extracted texture files
 *
 * Not converted (reported as warnings): VRM spring-bone physics, MToon shading,
 * material-colour / texture-transform expression binds, look-at.
 *
 * Coordinates: glTF is right-handed with the character facing +Z (VRM 1.0, GLB)
 * or -Z (VRM 0.x). PMX space is left-handed with the character facing -Z, which
 * is z → -z for +Z-facing sources; VRM 0.x additionally turns 180° about Y
 * (x → -x, z unchanged). Winding order is preserved (see PmxLoader).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { writePmx, type PmxBoneSpec, type PmxMaterialSpec, type PmxMorphSpec } from "./pmxWriter";
import type { Vec3 } from "../shared/character/rig";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface ConvertedImage {
  /** File name to write next to model.pmx; also the PMX texture path. */
  file: string;
  data: Buffer;
}

export interface GltfConversion {
  kind: "vrm0" | "vrm1" | "glb" | "gltf";
  pmx: Buffer;
  images: ConvertedImage[];
  modelName: string;
  /** Licence/usage terms from the VRM meta block, phrased for extractRestrictions. */
  licenseText?: string;
  warnings: string[];
}

const COMPONENT_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NORMALIZE_DIVISOR: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 };
const UNSUPPORTED_EXTENSIONS: Record<string, string> = {
  KHR_draco_mesh_compression: "Draco mesh compression",
  EXT_meshopt_compression: "meshopt compression",
};

const BONE_PART_NAMES: Record<string, string> = {
  hips: "Hips", spine: "Spine", chest: "Chest", upperChest: "UpperChest", neck: "Neck", head: "Head", eye: "Eye", jaw: "Jaw",
  upperLeg: "UpperLeg", lowerLeg: "LowerLeg", foot: "Foot", toes: "ToeBase",
  shoulder: "Shoulder", upperArm: "UpperArm", lowerArm: "LowerArm", hand: "Hand",
};

/** VRM expression (lower-cased) → [MMD morph name the face controller looks for, PMX panel]. */
const EXPRESSION_MORPHS: Record<string, [string, number]> = {
  blink: ["まばたき", 2], blink_l: ["ウィンク", 2], blinkleft: ["ウィンク", 2], blink_r: ["ウィンク右", 2], blinkright: ["ウィンク右", 2],
  a: ["あ", 3], aa: ["あ", 3], i: ["い", 3], ih: ["い", 3], u: ["う", 3], ou: ["う", 3], e: ["え", 3], ee: ["え", 3], o: ["お", 3], oh: ["お", 3],
  joy: ["にっこり", 3], happy: ["にっこり", 3], fun: ["笑い", 2], relaxed: ["笑い", 2],
  sorrow: ["悲しい", 1], sad: ["悲しい", 1], angry: ["怒り", 1], surprised: ["びっくり", 2],
};
/** Gaze presets drive look-at, which the app does with bones; converting them would double up. */
const SKIPPED_EXPRESSIONS: Record<string, true> = { neutral: true, lookup: true, lookdown: true, lookleft: true, lookright: true };

function readComponent(data: Buffer, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120: return data.readInt8(offset);
    case 5121: return data.readUInt8(offset);
    case 5122: return data.readInt16LE(offset);
    case 5123: return data.readUInt16LE(offset);
    case 5125: return data.readUInt32LE(offset);
    case 5126: return data.readFloatLE(offset);
    default: throw new Error(`Unsupported accessor component type ${componentType}.`);
  }
}

/** Column-major 4x4 product a·b. */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function sniffImageExt(data: Buffer): string | null {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) return "jpg";
  if (data.length > 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

function linearToSrgb(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Plain-language usage terms from the VRM meta block (only restrictive terms use the keywords extractRestrictions looks for). */
function vrmLicenseText(root: Json, version: "vrm0" | "vrm1"): { title: string; text: string } {
  const lines: string[] = [];
  let title = "";
  if (version === "vrm1") {
    const meta = root.extensions?.VRMC_vrm?.meta ?? {};
    title = String(meta.name ?? "");
    if (title) lines.push(`Model: ${title}`);
    if (Array.isArray(meta.authors) && meta.authors.length) lines.push(`Author: ${meta.authors.join(", ")}`);
    if (meta.licenseUrl) lines.push(`License: ${meta.licenseUrl}`);
    if (meta.avatarPermission === "onlyAuthor") lines.push("Only the author may use this avatar.");
    else if (meta.avatarPermission === "onlySeparatelyLicensedPerson") lines.push("Only separately licensed persons may use this avatar.");
    if (meta.commercialUsage === "personalNonProfit") lines.push("No commercial use: personal non-profit use only.");
    if (meta.redistribution === false) lines.push("Redistribution prohibited.");
    if (meta.modification === "prohibited") lines.push("Modification prohibited.");
    if (meta.allowSexualUsage === false) lines.push("No sexual use (R-18).");
    if (meta.otherLicenseUrl) lines.push(`Other terms: ${meta.otherLicenseUrl}`);
  } else {
    const meta = root.extensions?.VRM?.meta ?? {};
    title = String(meta.title ?? "");
    if (title) lines.push(`Model: ${title}`);
    if (meta.author) lines.push(`Author: ${meta.author}`);
    if (meta.licenseName) lines.push(`License: ${meta.licenseName}`);
    if (meta.allowedUserName === "OnlyAuthor") lines.push("Only the author may use this avatar.");
    else if (meta.allowedUserName === "ExplicitlyLicensedPerson") lines.push("Only explicitly licensed persons may use this avatar.");
    if (meta.commercialUssageName === "Disallow") lines.push("No commercial use.");
    if (meta.sexualUssageName === "Disallow") lines.push("No sexual use (R-18).");
    if (meta.violentUssageName === "Disallow") lines.push("No violent use.");
    if (meta.otherLicenseUrl) lines.push(`Other terms: ${meta.otherLicenseUrl}`);
  }
  return { title, text: lines.join("\n") };
}

export async function convertGltfToPmx(file: string, allowedRoot: string): Promise<GltfConversion> {
  const warnings: string[] = [];
  const raw = await fs.readFile(file);
  let json: Json = null;
  let glbBinary: Buffer | null = null;
  if (raw.length >= 12 && raw.readUInt32LE(0) === 0x46546c67) {
    if (raw.readUInt32LE(4) !== 2) throw new Error("Only glTF 2.0 / GLB 2 files are supported.");
    for (let offset = 12; offset + 8 <= raw.length;) {
      const length = raw.readUInt32LE(offset);
      const type = raw.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (type === 0x4e4f534a) json = JSON.parse(raw.toString("utf8", start, start + length));
      else if (type === 0x004e4942 && !glbBinary) glbBinary = raw.subarray(start, start + length);
      offset = start + ((length + 3) & ~3);
    }
    if (!json) throw new Error("GLB file has no JSON chunk.");
  } else {
    try {
      json = JSON.parse(raw.toString("utf8").replace(/^﻿/, ""));
    } catch {
      throw new Error("Not a valid glTF/GLB/VRM file.");
    }
  }
  if (!String(json.asset?.version ?? "").startsWith("2")) throw new Error("Only glTF 2.0 files are supported.");
  for (const extension of json.extensionsRequired ?? []) {
    const label = UNSUPPORTED_EXTENSIONS[extension];
    if (label) throw new Error(`This model uses ${label} (${extension}), which is not supported. Re-export it uncompressed.`);
  }

  const baseDir = path.dirname(file);
  const readExternal = async (uri: string): Promise<Buffer> => {
    const data = /^data:[^,]*;base64,(.*)$/s.exec(uri);
    if (data) return Buffer.from(data[1], "base64");
    if (/^data:/i.test(uri)) throw new Error("Unsupported data URI encoding in glTF.");
    const resolved = path.resolve(baseDir, decodeURIComponent(uri));
    const relative = path.relative(allowedRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`glTF references a file outside the model folder: ${uri}`);
    return fs.readFile(resolved);
  };
  const buffers: Buffer[] = await Promise.all(
    (json.buffers ?? []).map((b: Json) => (b.uri === undefined ? (glbBinary ?? Promise.reject(new Error("GLB binary chunk missing."))) : readExternal(b.uri)))
  );

  const readAccessor = (index: number): { values: Float64Array; count: number; size: number } => {
    const accessor = json.accessors?.[index];
    if (!accessor) throw new Error(`glTF accessor ${index} is missing.`);
    const size = COMPONENT_COUNT[accessor.type];
    const bytes = COMPONENT_BYTES[accessor.componentType];
    if (!size || !bytes) throw new Error(`glTF accessor ${index} has an unsupported type.`);
    const values = new Float64Array(accessor.count * size);
    if (accessor.bufferView !== undefined) {
      const view = json.bufferViews[accessor.bufferView];
      const data = buffers[view.buffer];
      const stride = view.byteStride || size * bytes;
      const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      for (let i = 0; i < accessor.count; i += 1) {
        for (let c = 0; c < size; c += 1) values[i * size + c] = readComponent(data, base + i * stride + c * bytes, accessor.componentType);
      }
    }
    const sparse = accessor.sparse;
    if (sparse) {
      const indexView = json.bufferViews[sparse.indices.bufferView];
      const valueView = json.bufferViews[sparse.values.bufferView];
      const indexBase = (indexView.byteOffset ?? 0) + (sparse.indices.byteOffset ?? 0);
      const valueBase = (valueView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);
      for (let i = 0; i < sparse.count; i += 1) {
        const target = readComponent(buffers[indexView.buffer], indexBase + i * COMPONENT_BYTES[sparse.indices.componentType], sparse.indices.componentType);
        for (let c = 0; c < size; c += 1) values[target * size + c] = readComponent(buffers[valueView.buffer], valueBase + (i * size + c) * bytes, accessor.componentType);
      }
    }
    if (accessor.normalized) {
      const divisor = NORMALIZE_DIVISOR[accessor.componentType];
      if (divisor) for (let i = 0; i < values.length; i += 1) values[i] = Math.max(-1, values[i] / divisor);
    }
    return { values, count: accessor.count, size };
  };

  // ---- format ---------------------------------------------------------------------
  const kind: GltfConversion["kind"] = json.extensions?.VRMC_vrm ? "vrm1" : json.extensions?.VRM ? "vrm0" : /\.gltf$/i.test(file) ? "gltf" : "glb";
  const vrm0 = kind === "vrm0";
  const sx = vrm0 ? -1 : 1;
  const sz = vrm0 ? 1 : -1;

  // ---- node tree ----------------------------------------------------------------------
  const nodes: Json[] = json.nodes ?? [];
  const parents = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((node, i) => { for (const child of node.children ?? []) if (child < nodes.length) parents[child] = i; });
  const sceneRoots: number[] = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => parents[i] < 0);
  const world: Float64Array[] = new Array(nodes.length);
  const visited: number[] = [];
  const stack = [...sceneRoots].reverse();
  while (stack.length) {
    const i = stack.pop() as number;
    const node = nodes[i];
    let local: Float64Array;
    if (node.matrix) {
      local = Float64Array.from(node.matrix);
    } else {
      const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
      const [scaleX, scaleY, scaleZ] = node.scale ?? [1, 1, 1];
      const [tx, ty, tz] = node.translation ?? [0, 0, 0];
      const x2 = x + x; const y2 = y + y; const z2 = z + z;
      const xx = x * x2; const xy = x * y2; const xz = x * z2; const yy = y * y2; const yz = y * z2; const zz = z * z2;
      const wx = w * x2; const wy = w * y2; const wz = w * z2;
      local = Float64Array.from([
        (1 - (yy + zz)) * scaleX, (xy + wz) * scaleX, (xz - wy) * scaleX, 0,
        (xy - wz) * scaleY, (1 - (xx + zz)) * scaleY, (yz + wx) * scaleY, 0,
        (xz + wy) * scaleZ, (yz - wx) * scaleZ, (1 - (xx + yy)) * scaleZ, 0,
        tx, ty, tz, 1,
      ]);
    }
    const parent = parents[i];
    world[i] = parent >= 0 && world[parent] ? mul(world[parent], local) : local;
    visited.push(i);
    const children: number[] = node.children ?? [];
    for (let c = children.length - 1; c >= 0; c -= 1) stack.push(children[c]);
  }
  const visitedSet = new Set(visited);

  // ---- humanoid bone naming ---------------------------------------------------------------
  const humanBones: Array<{ bone: string; node: number }> = vrm0
    ? (json.extensions.VRM.humanoid?.humanBones ?? []).map((h: Json) => ({ bone: String(h.bone), node: h.node }))
    : Object.entries(json.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {}).map(([bone, v]) => ({ bone, node: (v as Json).node }));
  const hasMetacarpal = { left: false, right: false } as Record<string, boolean>;
  for (const { bone } of humanBones) {
    const m = /^(left|right)Thumb(Metacarpal)$/.exec(bone);
    if (m) hasMetacarpal[m[1]] = true;
  }
  const canonicalName = new Map<number, string>();
  let hipsNode = -1;
  for (const { bone, node } of humanBones) {
    if (!visitedSet.has(node) || canonicalName.has(node)) continue;
    const sided = /^(left|right)(.+)$/.exec(bone);
    const side = sided ? sided[1] : null;
    const rest = sided ? sided[2][0].toLowerCase() + sided[2].slice(1) : bone;
    const code = side === "left" ? "L" : side === "right" ? "R" : "C";
    const finger = /^(thumb|index|middle|ring|little)(Metacarpal|Proximal|Intermediate|Distal)$/.exec(rest);
    let part = BONE_PART_NAMES[rest];
    if (finger) {
      const joint = finger[2];
      const number = finger[1] === "thumb" && side && hasMetacarpal[side]
        ? { Metacarpal: 1, Proximal: 2, Intermediate: 2, Distal: 3 }[joint]
        : { Metacarpal: 1, Proximal: 1, Intermediate: 2, Distal: 3 }[joint];
      part = `${finger[1][0].toUpperCase()}${finger[1].slice(1)}${number}`;
    }
    if (!part) continue;
    canonicalName.set(node, `J_Bip_${code}_${part}`);
    if (bone === "hips") hipsNode = node;
  }

  // ---- which nodes become bones ------------------------------------------------------------------
  const included = new Set<number>();
  const include = (n: number): void => {
    for (let cursor = n; cursor >= 0 && !included.has(cursor); cursor = parents[cursor]) included.add(cursor);
  };
  for (const i of visited) {
    if (nodes[i].mesh !== undefined && nodes[i].skin !== undefined) for (const joint of json.skins?.[nodes[i].skin]?.joints ?? []) if (visitedSet.has(joint)) include(joint);
  }
  for (const node of canonicalName.keys()) include(node);
  for (const i of visited) {
    if (nodes[i].mesh === undefined || nodes[i].skin !== undefined) continue;
    let anchored = false;
    for (let cursor = i; cursor >= 0; cursor = parents[cursor]) anchored = anchored || included.has(cursor);
    if (!anchored) include(i);
  }
  const boneNodes = visited.filter((i) => included.has(i));
  if (boneNodes.length === 0) warnings.push("The model has no skeleton; a single root bone was added, so it cannot be posed.");
  const boneOf = new Map<number, number>(boneNodes.map((n, i) => [n, i]));
  const usedNames = new Set<string>();
  const bones: PmxBoneSpec[] = boneNodes.map((n, index) => {
    const original = String(nodes[n].name ?? "").trim() || `node_${n}`;
    let name = canonicalName.get(n) ?? original;
    for (let suffix = 2; usedNames.has(name); suffix += 1) name = `${canonicalName.get(n) ?? original}.${suffix}`;
    usedNames.add(name);
    const m = world[n];
    return {
      name,
      englishName: original,
      position: [sx * m[12], m[13], sz * m[14]] as Vec3,
      parent: boneOf.get(parents[n]) ?? -1,
      tail: -1,
      translatable: parents[n] < 0 || n === hipsNode,
    };
  });
  if (bones.length === 0) bones.push({ name: "Root", englishName: "Root", position: [0, 0, 0], parent: -1, tail: -1, translatable: true });
  // Tail: connect each bone to its largest child chain (gives the analyser a bone direction).
  const weight = new Int32Array(bones.length).fill(1);
  for (let i = bones.length - 1; i >= 0; i -= 1) if (bones[i].parent >= 0) weight[bones[i].parent] += weight[i];
  for (let i = 0; i < bones.length; i += 1) {
    const parent = bones[i].parent;
    if (parent < 0) continue;
    const current = bones[parent].tail;
    if (current < 0 || weight[i] > weight[current]) bones[parent].tail = i;
  }
  const attachBone = (node: number): number => {
    for (let cursor = node; cursor >= 0; cursor = parents[cursor]) {
      const bone = boneOf.get(cursor);
      if (bone !== undefined) return bone;
    }
    return 0;
  };

  // ---- geometry --------------------------------------------------------------------------------------
  interface Instance {
    mesh: number;
    primitive: Json;
    offset: number;
    count: number;
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    boneIndices: Int32Array;
    boneWeights: Float32Array;
    /** Skinning matrix of each vertex's dominant joint (or the node's world matrix). */
    matrixOf: Float64Array[];
  }
  const instances: Instance[] = [];
  const buckets = new Map<number, number[]>();
  let vertexTotal = 0;
  for (const nodeIndex of visited) {
    const node = nodes[nodeIndex];
    if (node.mesh === undefined) continue;
    const mesh = json.meshes?.[node.mesh];
    if (!mesh) continue;
    const skin = node.skin !== undefined ? json.skins?.[node.skin] : null;
    const inverseBind = skin?.inverseBindMatrices !== undefined ? readAccessor(skin.inverseBindMatrices).values : null;
    const jointMatrices = new Map<number, Float64Array>();
    const fallbackBone = attachBone(nodeIndex);
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) {
        warnings.push(`Skipped a ${mode < 4 ? "point/line" : "unknown"} primitive in mesh "${mesh.name ?? node.mesh}".`);
        continue;
      }
      if (primitive.attributes?.POSITION === undefined) continue;
      const position = readAccessor(primitive.attributes.POSITION);
      const count = position.count;
      const normal = primitive.attributes.NORMAL !== undefined ? readAccessor(primitive.attributes.NORMAL).values : null;
      const uv = primitive.attributes.TEXCOORD_0 !== undefined ? readAccessor(primitive.attributes.TEXCOORD_0).values : null;
      const jointSets = [0, 1].filter((s) => primitive.attributes[`JOINTS_${s}`] !== undefined && primitive.attributes[`WEIGHTS_${s}`] !== undefined)
        .map((s) => ({ joints: readAccessor(primitive.attributes[`JOINTS_${s}`]).values, weights: readAccessor(primitive.attributes[`WEIGHTS_${s}`]).values }));
      const skinned = !!skin && jointSets.length > 0;

      let triangles: number[];
      const source = primitive.indices !== undefined ? readAccessor(primitive.indices).values : Float64Array.from({ length: count }, (_, i) => i);
      if (mode === 4) {
        triangles = Array.from(source.subarray(0, source.length - (source.length % 3)));
      } else {
        triangles = [];
        for (let i = 2; i < source.length; i += 1) {
          if (mode === 5) triangles.push(i % 2 === 0 ? source[i - 2] : source[i - 1], i % 2 === 0 ? source[i - 1] : source[i - 2], source[i]);
          else triangles.push(source[0], source[i - 1], source[i]);
        }
      }

      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const uvs = new Float32Array(count * 2);
      const boneIndices = new Int32Array(count * 4);
      const boneWeights = new Float32Array(count * 4);
      const matrixOf: Float64Array[] = new Array(count);
      const worldPositions = new Float64Array(count * 3);
      const worldNormals = new Float64Array(count * 3);
      const nodeMatrix = world[nodeIndex];
      for (let v = 0; v < count; v += 1) {
        let matrix = nodeMatrix;
        if (skinned) {
          const candidates = new Map<number, number>();
          let dominantJoint = -1;
          let dominantWeight = 0;
          for (const set of jointSets) {
            for (let k = 0; k < 4; k += 1) {
              const w = set.weights[v * 4 + k];
              if (!(w > 0)) continue;
              const joint = set.joints[v * 4 + k];
              const bone = boneOf.get(skin.joints[joint]);
              if (bone === undefined) continue;
              candidates.set(bone, (candidates.get(bone) ?? 0) + w);
              if (w > dominantWeight) { dominantWeight = w; dominantJoint = joint; }
            }
          }
          if (dominantJoint >= 0) {
            let cached = jointMatrices.get(dominantJoint);
            if (!cached) {
              const jointWorld = world[skin.joints[dominantJoint]];
              cached = inverseBind ? mul(jointWorld, inverseBind.subarray(dominantJoint * 16, dominantJoint * 16 + 16)) : jointWorld;
              jointMatrices.set(dominantJoint, cached);
            }
            matrix = cached;
          }
          const top = [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
          const total = top.reduce((sum, [, w]) => sum + w, 0);
          if (total > 0) {
            top.forEach(([bone, w], k) => { boneIndices[v * 4 + k] = bone; boneWeights[v * 4 + k] = w / total; });
          } else {
            boneIndices[v * 4] = fallbackBone;
            boneWeights[v * 4] = 1;
          }
        } else {
          boneIndices[v * 4] = fallbackBone;
          boneWeights[v * 4] = 1;
        }
        matrixOf[v] = matrix;
        const x = position.values[v * 3]; const y = position.values[v * 3 + 1]; const z = position.values[v * 3 + 2];
        worldPositions[v * 3] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        worldPositions[v * 3 + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        worldPositions[v * 3 + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        if (normal) {
          const nx = normal[v * 3]; const ny = normal[v * 3 + 1]; const nz = normal[v * 3 + 2];
          worldNormals[v * 3] = matrix[0] * nx + matrix[4] * ny + matrix[8] * nz;
          worldNormals[v * 3 + 1] = matrix[1] * nx + matrix[5] * ny + matrix[9] * nz;
          worldNormals[v * 3 + 2] = matrix[2] * nx + matrix[6] * ny + matrix[10] * nz;
        }
        if (uv) { uvs[v * 2] = uv[v * 2]; uvs[v * 2 + 1] = uv[v * 2 + 1]; }
      }

      // A mirrored node transform flips the triangle winding.
      const m = nodeMatrix;
      const mirrored = !skinned && m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]) < 0;
      if (mirrored) for (let t = 0; t < triangles.length; t += 3) [triangles[t + 1], triangles[t + 2]] = [triangles[t + 2], triangles[t + 1]];

      if (!normal) {
        for (let t = 0; t < triangles.length; t += 3) {
          const [a, b, c] = [triangles[t] * 3, triangles[t + 1] * 3, triangles[t + 2] * 3];
          const e1 = [worldPositions[b] - worldPositions[a], worldPositions[b + 1] - worldPositions[a + 1], worldPositions[b + 2] - worldPositions[a + 2]];
          const e2 = [worldPositions[c] - worldPositions[a], worldPositions[c + 1] - worldPositions[a + 1], worldPositions[c + 2] - worldPositions[a + 2]];
          const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          for (const vertex of [a, b, c]) for (let k = 0; k < 3; k += 1) worldNormals[vertex + k] += face[k];
        }
      }
      for (let v = 0; v < count; v += 1) {
        const nx = worldNormals[v * 3]; const ny = worldNormals[v * 3 + 1]; const nz = worldNormals[v * 3 + 2];
        const length = Math.hypot(nx, ny, nz) || 1;
        positions[v * 3] = sx * worldPositions[v * 3]; positions[v * 3 + 1] = worldPositions[v * 3 + 1]; positions[v * 3 + 2] = sz * worldPositions[v * 3 + 2];
        normals[v * 3] = (sx * nx) / length; normals[v * 3 + 1] = ny / length; normals[v * 3 + 2] = (sz * nz) / length;
      }

      const key = primitive.material ?? -1;
      const bucket = buckets.get(key) ?? [];
      for (const index of triangles) bucket.push(index + vertexTotal);
      buckets.set(key, bucket);
      instances.push({ mesh: node.mesh, primitive, offset: vertexTotal, count, positions, normals, uvs, boneIndices, boneWeights, matrixOf });
      vertexTotal += count;
    }
  }
  if (vertexTotal === 0) throw new Error("The model contains no triangle meshes.");

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const boneIndices = new Int32Array(vertexTotal * 4);
  const boneWeights = new Float32Array(vertexTotal * 4);
  for (const inst of instances) {
    positions.set(inst.positions, inst.offset * 3);
    normals.set(inst.normals, inst.offset * 3);
    uvs.set(inst.uvs, inst.offset * 2);
    boneIndices.set(inst.boneIndices, inst.offset * 4);
    boneWeights.set(inst.boneWeights, inst.offset * 4);
  }

  // ---- materials and textures ---------------------------------------------------------------------------
  const images: ConvertedImage[] = [];
  const textureSlots: string[] = [];
  const slotOfImage = new Map<number, number>();
  const materials: PmxMaterialSpec[] = [];
  const indexChunks: number[][] = [];
  for (const [materialIndex, bucket] of buckets) {
    const material = materialIndex >= 0 ? json.materials?.[materialIndex] : null;
    const props = vrm0 && materialIndex >= 0 ? json.extensions.VRM.materialProperties?.[materialIndex] : null;
    const pbr = material?.pbrMetallicRoughness;
    let factor: number[] = pbr?.baseColorFactor ?? [1, 1, 1, 1];
    if (!pbr?.baseColorFactor && Array.isArray(props?.vectorProperties?._Color)) factor = props.vectorProperties._Color;
    const textureIndex: number | undefined = pbr?.baseColorTexture?.index ?? props?.textureProperties?._MainTex;
    let slot = -1;
    if (textureIndex !== undefined) {
      const texture = json.textures?.[textureIndex];
      const imageIndex: number | undefined = texture?.source ?? texture?.extensions?.KHR_texture_webp?.source ?? texture?.extensions?.EXT_texture_webp?.source;
      if (imageIndex !== undefined && slotOfImage.has(imageIndex)) {
        slot = slotOfImage.get(imageIndex) as number;
      } else if (imageIndex !== undefined) {
        const image = json.images?.[imageIndex];
        let data: Buffer | null = null;
        if (image?.bufferView !== undefined) {
          const view = json.bufferViews[image.bufferView];
          data = buffers[view.buffer].subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        } else if (image?.uri !== undefined) {
          data = await readExternal(image.uri).catch((error: Error) => { warnings.push(`Texture ${image.uri} could not be read: ${error.message}`); return null; });
        }
        const ext = data ? sniffImageExt(data) : null;
        if (data && ext) {
          const name = `img_${imageIndex}.${ext}`;
          images.push({ file: name, data: Buffer.from(data) });
          slot = textureSlots.length;
          textureSlots.push(name);
          slotOfImage.set(imageIndex, slot);
        } else if (data) {
          warnings.push(`Texture image ${imageIndex} uses an unsupported format (only PNG, JPEG and WebP are converted).`);
        }
      }
    }
    const opaque = (material?.alphaMode ?? "OPAQUE") === "OPAQUE";
    let outline = false;
    if (vrm0) outline = (props?.floatProperties?._OutlineWidthMode ?? 0) > 0 && (props?.floatProperties?._OutlineWidth ?? 0) > 0;
    else {
      const mtoon = material?.extensions?.VRMC_materials_mtoon;
      outline = !!mtoon && mtoon.outlineWidthMode !== undefined && mtoon.outlineWidthMode !== "none" && (mtoon.outlineWidthFactor ?? 0) > 0;
    }
    const diffuse: [number, number, number, number] = [linearToSrgb(factor[0]), linearToSrgb(factor[1]), linearToSrgb(factor[2]), opaque ? 1 : (factor[3] ?? 1)];
    const name = String(material?.name ?? "").trim() || `material_${materialIndex}`;
    materials.push({
      name,
      englishName: name,
      diffuse,
      specular: [0, 0, 0],
      shininess: 5,
      ambient: [diffuse[0] * 0.5, diffuse[1] * 0.5, diffuse[2] * 0.5],
      flags: (material?.doubleSided ? 0x01 : 0) | (outline ? 0x10 : 0),
      edgeColor: [0, 0, 0, 1],
      edgeSize: 1,
      texture: slot,
      indexCount: bucket.length,
    });
    indexChunks.push(bucket);
  }
  const indices = new Uint32Array(indexChunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0;
  for (const chunk of indexChunks) { indices.set(chunk, cursor); cursor += chunk.length; }

  // ---- morphs ---------------------------------------------------------------------------------------------------
  const instancesByMesh = new Map<number, Instance[]>();
  for (const inst of instances) instancesByMesh.set(inst.mesh, [...(instancesByMesh.get(inst.mesh) ?? []), inst]);
  const collect = (binds: Array<{ mesh: number; index: number; weight: number }>): Array<{ index: number; offset: Vec3 }> => {
    const sums = new Map<number, Vec3>();
    for (const bind of binds) {
      for (const inst of instancesByMesh.get(bind.mesh) ?? []) {
        const target = inst.primitive.targets?.[bind.index]?.POSITION;
        if (target === undefined) continue;
        const delta = readAccessor(target).values;
        for (let i = 0; i < inst.count; i += 1) {
          const dx = delta[i * 3]; const dy = delta[i * 3 + 1]; const dz = delta[i * 3 + 2];
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const m = inst.matrixOf[i];
          const entry = sums.get(inst.offset + i) ?? [0, 0, 0];
          entry[0] += sx * (m[0] * dx + m[4] * dy + m[8] * dz) * bind.weight;
          entry[1] += (m[1] * dx + m[5] * dy + m[9] * dz) * bind.weight;
          entry[2] += sz * (m[2] * dx + m[6] * dy + m[10] * dz) * bind.weight;
          sums.set(inst.offset + i, entry);
        }
      }
    }
    return [...sums.entries()].filter(([, o]) => Math.abs(o[0]) + Math.abs(o[1]) + Math.abs(o[2]) > 1e-7).map(([index, offset]) => ({ index, offset }));
  };

  const morphs: PmxMorphSpec[] = [];
  const morphNames = new Set<string>();
  const addMorph = (name: string, englishName: string, panel: number, vertex: PmxMorphSpec["vertex"]): void => {
    let unique = name;
    for (let n = 2; morphNames.has(unique); n += 1) unique = `${name}${n}`;
    morphNames.add(unique);
    morphs.push({ name: unique, englishName, panel, vertex });
  };

  const expressions: Array<{ name: string; binds: Array<{ mesh: number; index: number; weight: number }>; hasColorBinds: boolean }> = [];
  if (vrm0) {
    for (const group of json.extensions.VRM.blendShapeMaster?.blendShapeGroups ?? []) {
      const preset = String(group.presetName ?? "unknown").toLowerCase();
      expressions.push({
        name: preset === "unknown" ? String(group.name ?? "") : preset,
        binds: (group.binds ?? []).map((b: Json) => ({ mesh: b.mesh, index: b.index, weight: (b.weight ?? 100) / 100 })),
        hasColorBinds: (group.materialValues ?? []).length > 0,
      });
    }
  } else if (kind === "vrm1") {
    const table = json.extensions.VRMC_vrm.expressions ?? {};
    for (const [group, entries] of [["preset", table.preset ?? {}], ["custom", table.custom ?? {}]] as const) {
      for (const [key, value] of Object.entries(entries as Record<string, Json>)) {
        expressions.push({
          name: group === "preset" ? key.toLowerCase() : key,
          binds: (value.morphTargetBinds ?? []).map((b: Json) => ({ mesh: nodes[b.node]?.mesh ?? -1, index: b.index, weight: b.weight ?? 1 })),
          hasColorBinds: (value.materialColorBinds ?? []).length > 0 || (value.textureTransformBinds ?? []).length > 0,
        });
      }
    }
  }
  let colorOnly = 0;
  for (const expression of expressions) {
    const lower = expression.name.toLowerCase();
    if (!expression.name || SKIPPED_EXPRESSIONS[lower]) continue;
    const vertex = collect(expression.binds);
    if (vertex.length === 0) {
      if (expression.hasColorBinds) colorOnly += 1;
      continue;
    }
    const mapped = EXPRESSION_MORPHS[lower];
    addMorph(mapped ? mapped[0] : expression.name, expression.name, mapped ? mapped[1] : 4, vertex);
  }
  if (colorOnly > 0) warnings.push(`${colorOnly} VRM expression(s) only change material colours or texture offsets and were skipped.`);

  const rawTargets = new Map<string, Array<{ mesh: number; index: number; weight: number }>>();
  (json.meshes ?? []).forEach((mesh: Json, meshIndex: number) => {
    const names: unknown[] = mesh.extras?.targetNames ?? mesh.primitives?.[0]?.extras?.targetNames ?? [];
    names.forEach((rawName, index) => {
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (name) rawTargets.set(name, [...(rawTargets.get(name) ?? []), { mesh: meshIndex, index, weight: 1 }]);
    });
  });
  for (const [name, binds] of rawTargets) {
    if (morphNames.has(name)) continue;
    const vertex = collect(binds);
    if (vertex.length > 0) addMorph(name, name, 4, vertex);
  }

  if (json.extensions?.VRMC_springBone || (json.extensions?.VRM?.secondaryAnimation?.boneGroups ?? []).length > 0) {
    warnings.push("VRM spring-bone physics is not converted; hair and clothing use the app's own secondary-motion system instead.");
  }
  if (kind === "vrm0" || kind === "vrm1") warnings.push("MToon shading is approximated with the app's anime material.");

  const meta = kind === "vrm0" || kind === "vrm1" ? vrmLicenseText(json, kind) : { title: "", text: "" };
  const modelName = meta.title || String(json.scenes?.[json.scene ?? 0]?.name ?? "").trim() || path.basename(file, path.extname(file));
  const pmx = writePmx({
    name: modelName,
    englishName: modelName,
    comment: `Converted from ${kind.toUpperCase()} by Hasu importer`,
    vertexCount: vertexTotal,
    positions,
    normals,
    uvs,
    boneIndices,
    boneWeights,
    indices,
    textures: textureSlots,
    materials,
    bones,
    morphs,
  });
  return { kind, pmx, images, modelName, licenseText: meta.text || undefined, warnings };
}
