/**
 * Minimal PMX 2.0 writer.
 *
 * Used to turn other model formats (VRM / GLB / glTF) into the PMX shape the
 * renderer already understands. Only what a converted humanoid needs is
 * written: vertices (BDEF1/2/4), faces, textures, materials, bones, vertex and
 * group morphs. No display frames, rigid bodies or joints.
 *
 * Text is UTF-16LE because `mmd-parser` (used by the renderer and the analyser)
 * ignores the header's encoding flag and always decodes UTF-16LE.
 *
 * Coordinates are PMX space: left-handed, Y up, the character faces -Z.
 */
import type { Vec3 } from "../shared/character/rig";

export interface PmxBoneSpec {
  name: string;
  englishName: string;
  /** Rest head position, PMX space. */
  position: Vec3;
  parent: number;
  /** Connected tail bone, or -1 for a zero tail offset. */
  tail: number;
  translatable: boolean;
}

export interface PmxMaterialSpec {
  name: string;
  englishName: string;
  diffuse: [number, number, number, number];
  specular: [number, number, number];
  shininess: number;
  ambient: [number, number, number];
  /** PMX draw flags: 0x01 double sided, 0x10 edge. */
  flags: number;
  edgeColor: [number, number, number, number];
  edgeSize: number;
  texture: number;
  /** Number of INDICES (3 per triangle) drawn by this material. */
  indexCount: number;
}

export interface PmxMorphSpec {
  name: string;
  englishName: string;
  /** 1 brow, 2 eye, 3 mouth, 4 other. */
  panel: number;
  vertex: Array<{ index: number; offset: Vec3 }>;
}

export interface PmxModelSpec {
  name: string;
  englishName: string;
  comment: string;
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 4 bone indices per vertex; unused slots must have weight 0. */
  boneIndices: Int32Array;
  boneWeights: Float32Array;
  /** Triangle vertex indices, grouped by material in material order. */
  indices: Uint32Array;
  textures: string[];
  materials: PmxMaterialSpec[];
  bones: PmxBoneSpec[];
  morphs: PmxMorphSpec[];
}

class ByteWriter {
  private buffer = Buffer.allocUnsafe(1 << 20);
  length = 0;

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length;
    while (size < this.length + extra) size *= 2;
    const next = Buffer.allocUnsafe(size);
    this.buffer.copy(next, 0, 0, this.length);
    this.buffer = next;
  }

  u8(value: number): void { this.reserve(1); this.buffer.writeUInt8(value, this.length); this.length += 1; }
  u16(value: number): void { this.reserve(2); this.buffer.writeUInt16LE(value, this.length); this.length += 2; }
  u32(value: number): void { this.reserve(4); this.buffer.writeUInt32LE(value >>> 0, this.length); this.length += 4; }
  i8(value: number): void { this.reserve(1); this.buffer.writeInt8(value, this.length); this.length += 1; }
  i16(value: number): void { this.reserve(2); this.buffer.writeInt16LE(value, this.length); this.length += 2; }
  i32(value: number): void { this.reserve(4); this.buffer.writeInt32LE(value, this.length); this.length += 4; }
  f32(value: number): void { this.reserve(4); this.buffer.writeFloatLE(Number.isFinite(value) ? value : 0, this.length); this.length += 4; }

  floats(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i += 1) this.f32(values[i]);
  }

  text(value: string): void {
    // mmd-parser decodes UTF-16LE and stops at the first NUL; always
    // terminate so trailing CJK bytes can't run into the next field.
    const bytes = Buffer.from(`${value}\0`, "utf16le");
    this.u32(bytes.length);
    this.reserve(bytes.length);
    bytes.copy(this.buffer, this.length);
    this.length += bytes.length;
  }
  /** Unsigned index (vertex indices). */
  uindex(value: number, size: number): void {
    if (size === 1) this.u8(value);
    else if (size === 2) this.u16(value);
    else this.i32(value);
  }

  /** Signed index (-1 = none). */
  index(value: number, size: number): void {
    if (size === 1) this.i8(value);
    else if (size === 2) this.i16(value);
    else this.i32(value);
  }

  toBuffer(): Buffer {
    return Buffer.from(this.buffer.subarray(0, this.length));
  }
}

const signedSize = (count: number): number => (count <= 0x7f ? 1 : count <= 0x7fff ? 2 : 4);

const FLAG_CONNECTED = 0x0001;
const FLAG_ROTATABLE = 0x0002;
const FLAG_TRANSLATABLE = 0x0004;
const FLAG_VISIBLE = 0x0008;
const FLAG_ENABLED = 0x0010;

export function writePmx(model: PmxModelSpec): Buffer {
  const w = new ByteWriter();
  const vertexSize = model.vertexCount <= 0xff ? 1 : model.vertexCount <= 0xffff ? 2 : 4;
  const textureSize = signedSize(model.textures.length);
  const materialSize = signedSize(model.materials.length);
  const boneSize = signedSize(model.bones.length);
  const morphSize = signedSize(model.morphs.length);
  const bodySize = 1;

  // ---- header ---------------------------------------------------------------
  w.u8(0x50); w.u8(0x4d); w.u8(0x58); w.u8(0x20); // "PMX "
  w.f32(2.0);
  w.u8(8);
  for (const value of [0 /* UTF-16LE */, 0 /* extra UV */, vertexSize, textureSize, materialSize, boneSize, morphSize, bodySize]) w.u8(value);
  w.text(model.name);
  w.text(model.englishName);
  w.text(model.comment);
  w.text("");

  // ---- vertices ---------------------------------------------------------------
  w.u32(model.vertexCount);
  for (let v = 0; v < model.vertexCount; v += 1) {
    w.f32(model.positions[v * 3]); w.f32(model.positions[v * 3 + 1]); w.f32(model.positions[v * 3 + 2]);
    w.f32(model.normals[v * 3]); w.f32(model.normals[v * 3 + 1]); w.f32(model.normals[v * 3 + 2]);
    w.f32(model.uvs[v * 2]); w.f32(model.uvs[v * 2 + 1]);
    let used = 0;
    for (let k = 0; k < 4; k += 1) if (model.boneWeights[v * 4 + k] > 0) used = k + 1;
    if (used <= 1) {
      w.u8(0);
      w.index(Math.max(0, model.boneIndices[v * 4]), boneSize);
    } else if (used === 2) {
      w.u8(1);
      w.index(model.boneIndices[v * 4], boneSize);
      w.index(model.boneIndices[v * 4 + 1], boneSize);
      w.f32(model.boneWeights[v * 4]);
    } else {
      w.u8(2);
      for (let k = 0; k < 4; k += 1) w.index(model.boneIndices[v * 4 + k], boneSize);
      for (let k = 0; k < 4; k += 1) w.f32(model.boneWeights[v * 4 + k]);
    }
    w.f32(1); // edge scale
  }

  // ---- faces ------------------------------------------------------------------
  w.u32(model.indices.length);
  for (let i = 0; i < model.indices.length; i += 1) w.uindex(model.indices[i], vertexSize);

  // ---- textures -----------------------------------------------------------------
  w.u32(model.textures.length);
  for (const texture of model.textures) w.text(texture);

  // ---- materials ----------------------------------------------------------------
  w.u32(model.materials.length);
  for (const m of model.materials) {
    w.text(m.name);
    w.text(m.englishName);
    w.floats(m.diffuse);
    w.floats(m.specular);
    w.f32(m.shininess);
    w.floats(m.ambient);
    w.u8(m.flags);
    w.floats(m.edgeColor);
    w.f32(m.edgeSize);
    w.index(m.texture, textureSize);
    w.index(-1, textureSize); // sphere texture
    w.u8(0); // sphere mode: none
    w.u8(0); // toon: own texture index ...
    w.index(-1, textureSize); // ... none
    w.text("");
    w.u32(m.indexCount);
  }

  // ---- bones --------------------------------------------------------------------
  w.u32(model.bones.length);
  for (const bone of model.bones) {
    w.text(bone.name);
    w.text(bone.englishName);
    w.floats(bone.position);
    w.index(bone.parent, boneSize);
    w.u32(0);
    const connected = bone.tail >= 0;
    w.u16(FLAG_ROTATABLE | FLAG_VISIBLE | FLAG_ENABLED | (connected ? FLAG_CONNECTED : 0) | (bone.translatable ? FLAG_TRANSLATABLE : 0));
    if (connected) w.index(bone.tail, boneSize);
    else w.floats([0, 0, 0]);
  }

  // ---- morphs -------------------------------------------------------------------
  w.u32(model.morphs.length);
  for (const morph of model.morphs) {
    w.text(morph.name);
    w.text(morph.englishName);
    w.u8(morph.panel);
    w.u8(1); // vertex morph
    w.u32(morph.vertex.length);
    for (const element of morph.vertex) {
      w.uindex(element.index, vertexSize);
      w.floats(element.offset);
    }
  }

  // ---- display frames, rigid bodies, joints: none ------------------------------------
  w.u32(0);
  w.u32(0);
  w.u32(0);
  return w.toBuffer();
}
