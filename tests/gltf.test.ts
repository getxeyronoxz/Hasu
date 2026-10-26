/**
 * VRM/GLB → PMX conversion tests: a synthetic humanoid GLB is built in memory
 * (node tree + skin + morph target + VRM1 humanoid/expression metadata), then
 * converted and imported end to end. Run: node --import tsx --test tests/gltf.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { convertGltfToPmx } from "../character_import/gltf";
import { importCharacter } from "../character_import/importer";
import { writePmx } from "../character_import/pmxWriter";

const nodeRequire = createRequire(import.meta.url);
// mmd-parser ships without types; same require pattern as character_import/importer.ts.
interface MmdParserResult { metadata: { vertexCount: number }; bones: Array<{ name: string }>; vertices: Array<{ position: number[] }>; morphs: Array<{ name: string }>; textures: string[] }
const { Parser: MmdParser } = nodeRequire("mmd-parser") as { Parser: new () => { parsePmx(data: ArrayBuffer): MmdParserResult } };

test("writePmx emits a file mmd-parser accepts", () => {
  const pmx = writePmx({
    name: "test", englishName: "test", comment: "",
    vertexCount: 3,
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: Float32Array.from([0, 0, 1, 0, 0, 1]),
    boneIndices: Int32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    boneWeights: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    indices: Uint32Array.from([0, 1, 2]),
    textures: [],
    materials: [{
      name: "mat", englishName: "mat", diffuse: [1, 1, 1, 1], specular: [0, 0, 0], shininess: 5,
      ambient: [0.5, 0.5, 0.5], flags: 0, edgeColor: [0, 0, 0, 1], edgeSize: 1, texture: -1, indexCount: 3,
    }],
    bones: [{ name: "Root", englishName: "Root", position: [0, 0, 0], parent: -1, tail: -1, translatable: true }],
    morphs: [{ name: "まばたき", englishName: "blink", panel: 2, vertex: [{ index: 0, offset: [0, -0.1, 0] }] }],
  });
  assert.equal(pmx.subarray(0, 4).toString("latin1"), "PMX ");
  assert.equal(pmx.readFloatLE(4), 2);
});

/** Minimal skinned humanoid GLB with a blink morph target and VRM1 metadata. */
function syntheticGlb(): Buffer {
  // Nodes: 0 hips → 1 spine → 2 chest → 3 neck → 4 head; 5/7 left/right upper arms → 6/8 hands.
  const nodes = [
    { name: "Hips", translation: [0, 10, 0], children: [1] },
    { name: "Spine", translation: [0, 1, 0], children: [2] },
    { name: "Chest", translation: [0, 2, 0], children: [3, 5, 7] },
    { name: "Neck", translation: [0, 2, 0], children: [4] },
    { name: "Head", translation: [0, 1, 0] },
    { name: "LeftUpperArm", translation: [1, 1.5, 0], children: [6] },
    { name: "LeftHand", translation: [2, 0, 0] },
    { name: "RightUpperArm", translation: [-1, 1.5, 0], children: [8] },
    { name: "RightHand", translation: [-2, 0, 0] },
  ];
  const joints = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  // 2 quads (front at z=+0.5 facing +Z, like a VRM face): head quad skinned to head, chest quad to chest.
  const positions = new Float32Array([-0.5, 15.5, 0.5, 0.5, 15.5, 0.5, 0.5, 16.5, 0.5, -0.5, 16.5, 0.5, -0.5, 11.5, 0.5, 0.5, 11.5, 0.5, 0.5, 13.5, 0.5, -0.5, 13.5, 0.5]);
  const normals = new Float32Array(8 * 3).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const jointIds = new Uint16Array([4, 4, 4, 4, 0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0]);
  const weights = new Float32Array(8 * 4).map((_, i) => (i % 4 === 0 ? 1 : 0));
  // Blink morph: head quad moves down 0.2 on the first primitive's 4 vertices.
  const blink = new Float32Array(8 * 3);
  for (let i = 0; i < 4; i += 1) blink[i * 3 + 1] = -0.2;
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  // 1x1 red PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const chunks: Buffer[] = [];
  const push = (data: Buffer | Float32Array | Uint16Array): number => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const offset = chunks.reduce((sum, c) => sum + c.length, 0);
    chunks.push(bytes);
    return offset;
  };
  const posOff = push(positions);
  const normOff = push(normals);
  const uvOff = push(uvs);
  const jointOff = push(jointIds);
  const weightOff = push(weights);
  const blinkOff = push(blink);
  const indexOff = push(indices);
  const pngOff = push(png);
  const bufferViews = [
    { buffer: 0, byteOffset: posOff, byteLength: positions.byteLength },
    { buffer: 0, byteOffset: normOff, byteLength: normals.byteLength },
    { buffer: 0, byteOffset: uvOff, byteLength: uvs.byteLength },
    { buffer: 0, byteOffset: jointOff, byteLength: jointIds.byteLength },
    { buffer: 0, byteOffset: weightOff, byteLength: weights.byteLength },
    { buffer: 0, byteOffset: blinkOff, byteLength: blink.byteLength },
    { buffer: 0, byteOffset: indexOff, byteLength: indices.byteLength },
    { buffer: 0, byteOffset: pngOff, byteLength: png.length },
  ];
  const accessors = [
    { bufferView: 0, componentType: 5126, count: 8, type: "VEC3" },
    { bufferView: 1, componentType: 5126, count: 8, type: "VEC3" },
    { bufferView: 2, componentType: 5126, count: 8, type: "VEC2" },
    { bufferView: 3, componentType: 5123, count: 8, type: "VEC4" },
    { bufferView: 4, componentType: 5126, count: 8, type: "VEC4" },
    { bufferView: 5, componentType: 5126, count: 8, type: "VEC3" },
    { bufferView: 6, componentType: 5123, count: 12, type: "SCALAR" },
  ];
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: nodes.map((n, i) => (i === 0 ? { ...n, mesh: 0, skin: 0 } : n)),
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, JOINTS_0: 3, WEIGHTS_0: 4 },
        targets: [{ POSITION: 5 }],
        indices: 6,
        material: 0,
      }],
      extras: { targetNames: ["blink"] },
    }],
    skins: [{ joints }],
    materials: [{ name: "face", pbrMetallicRoughness: { baseColorFactor: [1, 0.8, 0.8, 1], baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 7, mimeType: "image/png" }],
    buffers: [{ byteLength: chunks.reduce((s, c) => s + c.length, 0) }],
    bufferViews,
    accessors,
    extensions: {
      VRMC_vrm: {
        humanoid: {
          humanBones: {
            hips: { node: 0 }, spine: { node: 1 }, chest: { node: 2 }, neck: { node: 3 }, head: { node: 4 },
            leftUpperArm: { node: 5 }, leftHand: { node: 6 }, rightUpperArm: { node: 7 }, rightHand: { node: 8 },
          },
        },
        expressions: { preset: { blink: { morphTargetBinds: [{ node: 0, index: 0, weight: 1 }] } } },
        meta: { name: "TestGirl", authors: ["tester"], licenseUrl: "https://example.com/license" },
      },
    },
  };
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const bin = Buffer.concat(chunks.map((c) => (c.length % 4 ? Buffer.concat([c, Buffer.alloc(4 - (c.length % 4))]) : c)));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + ((jsonBytes.length + 3) & ~3) + 8 + bin.length, 8);
  const jsonChunk = Buffer.alloc(8 + ((jsonBytes.length + 3) & ~3), 0x20);
  jsonChunk.writeUInt32LE(jsonBytes.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  jsonBytes.copy(jsonChunk, 8);
  const binChunk = Buffer.alloc(8 + bin.length);
  binChunk.writeUInt32LE(bin.length, 0);
  binChunk.writeUInt32LE(0x004e4942, 4);
  bin.copy(binChunk, 8);
  return Buffer.concat([header, jsonChunk, binChunk]);
}

test("glb converts to pmx with humanoid bones, texture and blink morph", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasu-glb-"));
  try {
    const file = path.join(dir, "test.vrm");
    fs.writeFileSync(file, syntheticGlb());
    const result = await convertGltfToPmx(file, dir);
    assert.equal(result.kind, "vrm1");
    assert.equal(result.modelName, "TestGirl");
    assert.equal(result.images.length, 1);
    assert.match(result.images[0].file, /\.png$/);
    assert.ok(result.licenseText?.includes("tester"));

    const pmx = new MmdParser().parsePmx(result.pmx.buffer.slice(result.pmx.byteOffset, result.pmx.byteOffset + result.pmx.byteLength));
    assert.equal(pmx.metadata.vertexCount, 8);
    const names = pmx.bones.map((b) => b.name);
    for (const expected of ["J_Bip_C_Hips", "J_Bip_C_Spine", "J_Bip_C_Head", "J_Bip_L_UpperArm", "J_Bip_R_Hand"]) {
      assert.ok(names.includes(expected), `missing bone ${expected} in ${names.join(",")}`);
    }
    // +Z-facing glTF (face at z=+0.5) becomes -Z-facing PMX.
    assert.ok(pmx.vertices.every((v) => v.position[2] < 0));
    const morphNames = pmx.morphs.map((m) => m.name);
    assert.ok(morphNames.includes("まばたき"), `missing blink morph in ${morphNames.join(",")}`);
    assert.ok(morphNames.includes("blink"), `missing raw target morph in ${morphNames.join(",")}`);
    assert.equal(pmx.textures.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("importCharacter imports a .vrm file end to end", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasu-glb-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hasu-chars-"));
  try {
    const file = path.join(dir, "girl.vrm");
    fs.writeFileSync(file, syntheticGlb());
    const { profile, directory, warnings } = await importCharacter({ source: file, charactersRoot: root });
    assert.equal(profile.source.kind, "vrm");
    assert.equal(profile.model.convertedFrom, "vrm1");
    assert.ok(profile.skeleton.humanoid.HEAD, "HEAD should map");
    assert.ok(profile.morphs.map.blink, "blink slot should map");
    assert.ok(fs.existsSync(path.join(directory, "model.pmx")));
    assert.ok(fs.existsSync(path.join(directory, "textures", "img_0.png")));
    const conversion = profile.report.items.find((i) => i.feature === "Model conversion");
    assert.equal(conversion?.status, "partial");
    assert.ok(!warnings.some((w) => /texture.*missing/i.test(w)), warnings.join("; "));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("importCharacter rejects invalid glb bytes with a clear error", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasu-glb-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hasu-chars-"));
  try {
    const file = path.join(dir, "bad.vrm");
    fs.writeFileSync(file, Buffer.from("not a model"));
    await assert.rejects(importCharacter({ source: file, charactersRoot: root }), /could be parsed|Not a valid glTF/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
