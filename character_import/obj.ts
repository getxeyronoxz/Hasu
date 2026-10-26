/**
 * OBJ (+ MTL) → PMX converter.
 *
 * OBJ is a static format: no skeleton, no morphs, no skin weights. Converted
 * models come out as a single rigid body bound to one root bone, with one PMX
 * material per OBJ object (`o` part). They render, frame and sit correctly,
 * but cannot be posed, animated or expression-driven — the compatibility
 * report marks that honestly via the warnings returned here.
 *
 * The user's model has no `usemtl` lines (MTL exists but is unreferenced), so
 * textures are matched to parts by MTL declaration order as a fallback, and
 * by object-name heuristics first (Face/Hair/Eye parts get the matching
 * texture when the name suggests one).
 *
 * Coordinates: OBJ is right-handed, Y up. PMX space is left-handed with the
 * character facing -Z, so z → -z (winding preserved, see PmxLoader).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { writePmx, type PmxMaterialSpec } from "./pmxWriter";
import type { ConvertedImage } from "./gltf";

export interface ObjConversion {
  kind: "obj";
  pmx: Buffer;
  images: ConvertedImage[];
  modelName: string;
  warnings: string[];
}

interface ObjPart {
  name: string;
  /** Positions/normals/uvs already expanded per corner (no shared index). */
  positions: number[];
  normals: number[];
  uvs: number[];
  /** Resolved vertex indices into the merged arrays. */
  indices: number[];
}

function parseMtl(text: string): Array<{ name: string; diffuse: [number, number, number]; map?: string }> {
  const materials: Array<{ name: string; diffuse: [number, number, number]; map?: string }> = [];
  let current: { name: string; diffuse: [number, number, number]; map?: string } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) {
      current = { name: line.slice(7).trim(), diffuse: [1, 1, 1] };
      materials.push(current);
    } else if (current && line.startsWith("Kd ")) {
      const parts = line.slice(3).trim().split(/\s+/).map(Number);
      if (parts.length >= 3) current.diffuse = [parts[0], parts[1], parts[2]];
    } else if (current && line.startsWith("map_Kd ")) {
      current.map = line.slice(7).trim().split(/[/\\]/).pop();
    }
  }
  return materials;
}

export async function convertObjToPmx(file: string, allowedRoot: string): Promise<ObjConversion> {
  const warnings: string[] = [];
  const text = await fs.readFile(file, "utf8");
  const baseDir = path.dirname(file);

  const positions: number[][] = [];
  const normals: number[][] = [];
  const uvs: number[][] = [];
  const parts: ObjPart[] = [];
  let current: ObjPart | null = null;
  let currentMtl: string | null = null;
  const partMtl = new Map<string, string>();
  let negativeIndex = false;

  const part = (): ObjPart => {
    if (!current) {
      current = { name: "default", positions: [], normals: [], uvs: [], indices: [] };
      parts.push(current);
    }
    return current;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === "v") {
      positions.push([Number(rest[0]), Number(rest[1]), Number(rest[2])]);
    } else if (keyword === "vn") {
      normals.push([Number(rest[0]), Number(rest[1]), Number(rest[2])]);
    } else if (keyword === "vt") {
      uvs.push([Number(rest[0]), Number(rest[1] ?? 0)]);
    } else if (keyword === "o" || keyword === "g") {
      const name = rest.join(" ").trim() || "default";
      current = { name, positions: [], normals: [], uvs: [], indices: [] };
      parts.push(current);
      if (currentMtl) partMtl.set(name, currentMtl);
    } else if (keyword === "usemtl") {
      currentMtl = rest.join(" ").trim();
      if (current) partMtl.set(current.name, currentMtl);
      else part();
    } else if (keyword === "f") {
      const p = part();
      const corners = rest.map((corner) => {
        const [vi, ti, ni] = corner.split("/").map((s) => (s === "" ? 0 : Number(s)));
        return { vi, ti, ni };
      });
      if (corners.some((c) => c.vi < 0 || c.ti < 0 || c.ni < 0)) negativeIndex = true;
      // Fan-triangulate n-gons; OBJ faces are CCW for outward normals.
      for (let i = 1; i + 1 < corners.length; i += 1) {
        for (const corner of [corners[0], corners[i], corners[i + 1]]) {
          const vi = corner.vi < 0 ? positions.length + corner.vi : corner.vi - 1;
          const ti = corner.ti < 0 ? uvs.length + corner.ti : corner.ti - 1;
          const ni = corner.ni < 0 ? normals.length + corner.ni : corner.ni - 1;
          const pos = positions[vi];
          const nrm = ni >= 0 ? normals[ni] : [0, 1, 0];
          const uv = ti >= 0 ? uvs[ti] : [0, 0];
          if (!pos) throw new Error(`OBJ face references missing vertex ${corner.vi}.`);
          p.indices.push(p.positions.length / 3);
          p.positions.push(pos[0], pos[1], -pos[2]);
          p.normals.push(nrm[0], nrm[1], -(nrm[2] ?? 0));
          // OBJ UVs share WebGL's bottom-left origin, but the PMX format (and
          // PmxLoader with it) uses DirectX's top-left origin and flips V on
          // load. Pre-flip here so a converted PMX is a valid PMX file: any
          // MMD viewer — and our loader's flip — lands back on the authored
          // texel. Without this every texture renders vertically mirrored
          // (faces give it away instantly: eyes drift to the hairline).
          p.uvs.push(uv[0], 1 - (uv[1] ?? 0));
        }
      }
    }
  }
  if (negativeIndex) warnings.push("OBJ uses relative (negative) indices; resolved against the full vertex list.");
  const used = parts.filter((p) => p.indices.length > 0);
  if (used.length === 0) throw new Error("The OBJ file contains no faces.");

  // ---- materials and textures -------------------------------------------------
  const mtlFiles = [...text.matchAll(/^mtllib\s+(.+)$/gm)].map((m) => m[1].trim().split(/[/\\]/).pop() as string);
  let mtlMaterials: Array<{ name: string; diffuse: [number, number, number]; map?: string }> = [];
  for (const mtlFile of [...new Set(mtlFiles)]) {
    try {
      const resolved = path.resolve(baseDir, mtlFile);
      const relative = path.relative(allowedRoot, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      mtlMaterials.push(...parseMtl(await fs.readFile(resolved, "utf8")));
    } catch {
      warnings.push(`Material library ${mtlFile} could not be read.`);
    }
  }
  const textured = mtlMaterials.filter((m) => m.map);
  const images: ConvertedImage[] = [];
  const slotOfFile = new Map<string, number>();
  const slotOfHash = new Map<string, number>();
  const textureSlots: string[] = [];
  const readImage = async (fileName: string): Promise<number> => {
    const key = fileName.toLowerCase();
    const hit = slotOfFile.get(key);
    if (hit !== undefined) return hit;
    const resolved = path.resolve(baseDir, fileName);
    const relative = path.relative(allowedRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      warnings.push(`Texture ${fileName} is outside the model folder and was skipped.`);
      return -1;
    }
    let data: Buffer;
    try {
      data = await fs.readFile(resolved);
    } catch {
      warnings.push(`Texture ${fileName} could not be read.`);
      return -1;
    }
    const ext = path.extname(fileName).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(ext)) {
      warnings.push(`Texture ${fileName} uses an unsupported format and was skipped.`);
      return -1;
    }
    // Byte-identical exports (common in game rips) share one staged file so
    // every part samples the same slot and the character stays small on disk.
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(data).digest("hex");
    const dup = slotOfHash.get(digest);
    if (dup !== undefined) {
      slotOfFile.set(key, dup);
      return dup;
    }
    const out = `img_${textureSlots.length}${ext === ".jpeg" ? ".jpg" : ext}`;
    images.push({ file: out, data });
    textureSlots.push(out);
    slotOfFile.set(key, textureSlots.length - 1);
    slotOfHash.set(digest, textureSlots.length - 1);
    return textureSlots.length - 1;
  };

  // Part → texture: explicit usemtl first, then grouped fallback (below).
  const hasUsemtl = partMtl.size > 0;
  const slotOfPart = new Map<string, number>();
  const diffuseOfPart = new Map<string, [number, number, number]>();
  // Group a part by the trailing atlas token of `<Part>_<Material>_<Atlas>_<n>`
  // names (`Robe_Mid_Robe_0` → robe atlas, `Robe_Mid_Cloth_Body_0` → body).
  const groupOfName = (name: string): string => {
    const tail = name.replace(/_?\d+$/, "").split(/[_.\s-]+/).pop() ?? "";
    if (/^(body|cloth)$/i.test(tail)) return "BODY";
    if (/^(hair|face)$/i.test(tail)) return "FACE";
    if (/^robe$/i.test(tail)) return "ROBE";
    if (/face|hair|eye|ear|glass|brow|lash|mouth|teeth|tongue/i.test(name)) return "FACE";
    if (/robe/i.test(name)) return "ROBE";
    return "BODY";
  };
  if (!hasUsemtl && textured.length > 0) {
    // No usemtl lines (typical for game rips): cluster parts by name and deal
    // the distinct atlases across the clusters in canonical order, so body
    // parts → first atlas, face/hair → second, robe → third, regardless of
    // the order parts appear in the file. `*_Outline_*` shells reuse their
    // base part's atlas: they are the same surface pushed outward (the file
    // lists each shell right after its base), so the nearest preceding
    // non-outline part decides.
    const groupByPart = new Map<string, string>();
    let lastBase = "";
    for (const p of used) {
      const isShell = /outline/i.test(p.name);
      const group = isShell
        ? (groupByPart.get(lastBase) ?? groupOfName(p.name))
        : groupOfName(p.name);
      // Track the base part for the shell that follows it.
      if (!isShell) lastBase = p.name;
      groupByPart.set(p.name, group);
    }
    // Distinct atlases in MTL order, duplicates collapsed.
    const uniqueSlots: number[] = [];
    const uniqueDiffuse: Array<[number, number, number]> = [];
    for (const mtl of textured) {
      if (!mtl.map) continue;
      const slot = await readImage(mtl.map);
      if (slot < 0 || uniqueSlots.includes(slot)) continue;
      uniqueSlots.push(slot);
      uniqueDiffuse.push(mtl.diffuse);
    }
    const order = ["BODY", "FACE", "ROBE"];
    const groups = [...new Set(groupByPart.values())].sort(
      (a, b) => (order.includes(a) ? order.indexOf(a) : 99 + a.localeCompare(b))
        - (order.includes(b) ? order.indexOf(b) : 99 + b.localeCompare(b)),
    );
    const slotOfGroup = new Map<string, number>();
    const diffuseOfGroup = new Map<string, [number, number, number]>();
    groups.forEach((group, i) => {
      const pick = Math.min(i, uniqueSlots.length - 1);
      slotOfGroup.set(group, uniqueSlots[pick]);
      diffuseOfGroup.set(group, uniqueDiffuse[pick] ?? [1, 1, 1]);
    });
    for (const p of used) {
      const group = groupByPart.get(p.name) ?? "BODY";
      const slot = slotOfGroup.get(group);
      const diffuse = diffuseOfGroup.get(group);
      if (diffuse) diffuseOfPart.set(p.name, diffuse);
      if (slot !== undefined) slotOfPart.set(p.name, slot);
    }
    if (process.env.HASU_DEBUG_OBJ) {
      console.log(`[obj-debug] groups=${groups.join(",")} slots=${groups.map((g) => slotOfGroup.get(g)).join(",")}`);
    }
  } else {
    // Explicit usemtl assignments (or no textured materials at all): resolve
    // each part's material directly, dealing MTL order to unmapped parts.
    let mtlCursor = 0;
    for (const p of used) {
      const mtlName = partMtl.get(p.name);
      const mtl = mtlName ? mtlMaterials.find((m) => m.name === mtlName) : undefined;
      if (mtl) {
        diffuseOfPart.set(p.name, mtl.diffuse);
        if (mtl.map) slotOfPart.set(p.name, await readImage(mtl.map));
        continue;
      }
      const fallback = textured[mtlCursor % Math.max(1, textured.length)];
      if (fallback && textured.length > 0) {
        diffuseOfPart.set(p.name, fallback.diffuse);
        if (fallback.map) slotOfPart.set(p.name, await readImage(fallback.map));
        mtlCursor += 1;
      }
    }
  }

  // ---- merge ------------------------------------------------------------------
  let vertexTotal = 0;
  for (const p of used) vertexTotal += p.positions.length / 3;
  const mergedPositions = new Float32Array(vertexTotal * 3);
  const mergedNormals = new Float32Array(vertexTotal * 3);
  const mergedUvs = new Float32Array(vertexTotal * 2);
  const boneIndices = new Int32Array(vertexTotal * 4);
  const boneWeights = new Float32Array(vertexTotal * 4);
  const materials: PmxMaterialSpec[] = [];
  const indexChunks: number[][] = [];
  let cursor = 0;
  for (const p of used) {
    const count = p.positions.length / 3;
    mergedPositions.set(p.positions, cursor * 3);
    mergedNormals.set(p.normals, cursor * 3);
    mergedUvs.set(p.uvs, cursor * 2);
    for (let i = 0; i < count; i += 1) {
      boneIndices[(cursor + i) * 4] = 0;
      boneWeights[(cursor + i) * 4] = 1;
    }
    const diffuse = diffuseOfPart.get(p.name) ?? [1, 1, 1];
    const isOutline = /outline/i.test(p.name);
    materials.push({
      name: p.name,
      englishName: p.name,
      diffuse: [diffuse[0], diffuse[1], diffuse[2], 1],
      specular: [0, 0, 0],
      shininess: 5,
      ambient: [diffuse[0] * 0.5, diffuse[1] * 0.5, diffuse[2] * 0.5],
      flags: (isOutline ? 0x10 : 0) | 0x01,
      edgeColor: [0, 0, 0, 1],
      edgeSize: 1,
      texture: slotOfPart.get(p.name) ?? -1,
      indexCount: p.indices.length,
    });
    indexChunks.push(p.indices.map((i) => i + cursor));
    cursor += count;
  }
  const indices = new Uint32Array(indexChunks.reduce((sum, c) => sum + c.length, 0));
  let at = 0;
  for (const chunk of indexChunks) {
    indices.set(chunk, at);
    at += chunk.length;
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vertexTotal; i += 1) {
    const y = mergedPositions[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  const modelName = path.basename(file, path.extname(file));
  warnings.push(
    `OBJ is a static mesh: no skeleton, so the character renders and frames but cannot be posed or expression-driven (1 rigid bone, 0 morphs, 0 physics).`,
  );
  if (height > 0 && (height < 5 || height > 60)) {
    warnings.push(`Model height is ${height.toFixed(1)} units; Hasu auto-scales every character to the same on-screen size.`);
  }

  const pmx = writePmx({
    name: modelName,
    englishName: modelName,
    comment: "Converted from OBJ by Hasu importer",
    vertexCount: vertexTotal,
    positions: mergedPositions,
    normals: mergedNormals,
    uvs: mergedUvs,
    boneIndices,
    boneWeights,
    indices,
    textures: textureSlots,
    materials,
    bones: [{ name: "Root", englishName: "Root", position: [0, (minY + maxY) / 2, 0], parent: -1, tail: -1, translatable: true }],
    morphs: [],
  });
  return { kind: "obj", pmx, images, modelName, warnings };
}
