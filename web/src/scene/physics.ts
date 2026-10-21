import * as THREE from 'three/webgpu';
import type { Room } from './room';

/**
 * Physics with Rapier (WebAssembly): crumpled paper tossed into the bin, and the shelf books
 * that can be knocked over and tidied up again.
 *
 * - static colliders: triangle meshes of the room and furniture (in world space, metres)
 * - books: one convex-hull body each (split per book in Blender), fixed on the shelf until
 *   knocked over, then dynamic
 * - paper balls: small dynamic spheres with CCD (they are fast), removed when there are too many
 *
 * Rapier is loaded lazily (dynamic import) so it doesn't slow down the first paint.
 */

type RapierModule = typeof import('@dimforge/rapier3d-compat');
type World = InstanceType<RapierModule['World']>;
type RigidBody = ReturnType<World['createRigidBody']>;

const STATIC_COLLIDERS = [
  'Room_FloorPlanks', 'Room_Walls', 'Rug', 'Desk_Top', 'Desk_Legs', 'Monitor_Riser', 'Monitor_Body',
  'Dresser_Body', 'Shelf_1', 'Shelf_2', 'Shelf_3', 'PaperBin', 'Pouf', 'Blanket', 'Window_Sill', 'Notepad',
  'Lamp_Base', 'PencilHolder', 'Mug', 'Keyboard', 'Chair_Base', 'Chair_Seat', 'Chair_Back', 'Easel_Frame',
  'FloorPlant_Pot', 'Floor_Books', 'Calendar_Base', 'Plate', 'HeadphoneStand_Base', 'Slippers', 'ArtStool',
];
const BOOK_NAME = /^Shelf_(\d)_Book_\d+$/;
const MAX_PAPER = 10;
const STEP = 1 / 60;

interface Book { node: THREE.Object3D; shelf: number; body: RigidBody; restPos: THREE.Vector3; restQuat: THREE.Quaternion }
interface Paper { mesh: THREE.Mesh; body: RigidBody; scored: boolean; age: number }

export interface Physics {
  tossPaper(): void;
  knockBooks(shelf?: number): void;
  tidyBooks(): void;
  update(dt: number): void;
  /** names of the books that have a physics body (debugging) */
  readonly bookNames: string[];
}

/** world-space triangle soup of every mesh under `node` */
const worldTriangles = (node: THREE.Object3D) => {
  const verts: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  node.updateWorldMatrix(true, true);
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.glow) return; // skip the hover-glow copies (ui/hints.ts)
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const base = verts.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      verts.push(v.x, v.y, v.z);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) idx.push(base + i);
  });
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
};

/** a crumpled-paper ball: an icosphere with jittered vertices (shared by all balls) */
const paperGeometry = (radius: number) => {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 0.78 + 0.3 * Math.abs(Math.sin(v.x * 97.3 + v.y * 51.1 + v.z * 23.7));
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals();
  return g;
};

export const createPhysics = async (scene: THREE.Scene, room: Room, onScore: (count: number) => void): Promise<Physics> => {
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;

  // ---- static world
  for (const name of STATIC_COLLIDERS) {
    const node = room.root.getObjectByName(name);
    if (!node) continue;
    const { verts, idx } = worldTriangles(node);
    if (idx.length) world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.7).setRestitution(0.2));
  }

  // ---- books: convex hull per book, fixed until knocked over
  const books: Book[] = [];
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  room.root.traverse((o) => {
    const m = BOOK_NAME.exec(o.name);
    if (!m) return;
    o.updateWorldMatrix(true, true);
    o.matrixWorld.decompose(tmpV, tmpQ, tmpS);
    const inv = tmpQ.clone().invert();
    const { verts } = worldTriangles(o);
    for (let i = 0; i < verts.length; i += 3) {   // hull points in the body's own frame
      const p = new THREE.Vector3(verts[i], verts[i + 1], verts[i + 2]).sub(tmpV).applyQuaternion(inv);
      verts[i] = p.x; verts[i + 1] = p.y; verts[i + 2] = p.z;
    }
    const hull = RAPIER.ColliderDesc.convexHull(verts);
    if (!hull) {
      console.warn('No convex hull for', o.name, verts.length / 3, 'points');
      return;
    }
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(tmpV.x, tmpV.y, tmpV.z).setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w })
      .setLinearDamping(0.1).setAngularDamping(0.2));
    world.createCollider(hull.setDensity(700).setFriction(0.6).setRestitution(0.15), body);
    books.push({ node: o, shelf: Number(m[1]), body, restPos: tmpV.clone(), restQuat: tmpQ.clone() });
  });

  // ---- paper
  const PAPER_R = 0.028;
  const paperGeo = paperGeometry(PAPER_R);
  const paperMat = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.95 });
  const papers: Paper[] = [];
  const notepad = room.root.getObjectByName('Notepad');
  const bin = room.root.getObjectByName('PaperBin');
  const binPos = new THREE.Vector3();
  bin?.getWorldPosition(binPos);
  const BIN_INNER_R = 0.115;
  const BIN_H = 0.30;
  let scored = 0;

  const sPos = new THREE.Vector3();
  const sQuat = new THREE.Quaternion();
  const sScale = new THREE.Vector3();
  const sDummy = new THREE.Vector3();
  const sDummyQ = new THREE.Quaternion();
  const sWorld = new THREE.Matrix4();
  const syncNode = (node: THREE.Object3D, body: RigidBody) => {
    // body pose is world space; the node lives under the (scaled) StudyRoom root
    const t = body.translation();
    const r = body.rotation();
    const parent = node.parent!;
    parent.updateWorldMatrix(true, false);
    parent.matrixWorld.decompose(sDummy, sDummyQ, sScale);
    sWorld.compose(sPos.set(t.x, t.y, t.z), sQuat.set(r.x, r.y, r.z, r.w), sScale);
    node.matrix.copy(parent.matrixWorld).invert().multiply(sWorld);
    node.matrix.decompose(node.position, node.quaternion, node.scale);
  };

  let accumulator = 0;
  const anyAwake = () => papers.length > 0 || books.some((b) => b.body.isDynamic() && !b.body.isSleeping());

  return {
    get bookNames() { return books.map((b) => b.node.name); },

    tossPaper() {
      if (!notepad || !bin) return;
      // the notepad sits under the overhanging monitor: start in front of the screen, towards the room
      const start = notepad.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.13, 0.06, 0));
      // aim at the middle of the bin opening, with a human amount of error
      const target = binPos.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.22, BIN_H * 0.85, (Math.random() - 0.5) * 0.22));
      // flight time grows with the distance: a gentle arc across the room
      const T = 0.35 + 0.3 * Math.hypot(target.x - start.x, target.z - start.z) + Math.random() * 0.08;
      const vel = target.sub(start).divideScalar(T);
      vel.y += 0.5 * 9.81 * T;                                   // ballistic: compensate gravity
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z).setLinvel(vel.x, vel.y, vel.z)
        .setAngvel({ x: Math.random() * 8, y: Math.random() * 8, z: Math.random() * 8 })
        .setCcdEnabled(true).setLinearDamping(0.05));
      world.createCollider(RAPIER.ColliderDesc.ball(PAPER_R).setDensity(60).setRestitution(0.3).setFriction(0.8), body);
      const mesh = new THREE.Mesh(paperGeo, paperMat);
      mesh.castShadow = true;
      mesh.position.copy(start);
      scene.add(mesh);
      papers.push({ mesh, body, scored: false, age: 0 });
      while (papers.length > MAX_PAPER) {
        const old = papers.shift()!;
        world.removeRigidBody(old.body);
        scene.remove(old.mesh);                                  // geometry + material are shared: no dispose
      }
    },

    knockBooks(shelf?: number) {
      for (const b of books) {
        if (shelf !== undefined && b.shelf !== shelf) continue;
        b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        const m = b.body.mass();
        const c = b.body.translation();
        // a push like a hand: into the room (away from the +X wall), above the centre so they tip
        b.body.applyImpulseAtPoint(
          { x: -(0.85 + Math.random() * 0.35) * m, y: 0.1 * m, z: (Math.random() - 0.5) * 0.3 * m },
          { x: c.x + 0.02, y: c.y + 0.08, z: c.z }, true);
      }
    },

    tidyBooks() {
      for (const b of books) {
        b.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
        b.body.setTranslation(b.restPos, false);
        b.body.setRotation(b.restQuat, false);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        b.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        syncNode(b.node, b.body);
      }
    },

    update(dt: number) {
      if (!anyAwake()) return;                                   // nothing moving: skip the simulation
      accumulator = Math.min(accumulator + dt, STEP * 4);
      while (accumulator >= STEP) {
        world.step();
        accumulator -= STEP;
      }
      for (const b of books) if (b.body.isDynamic()) syncNode(b.node, b.body);
      for (const p of papers) {
        const t = p.body.translation();
        const r = p.body.rotation();
        p.mesh.position.set(t.x, t.y, t.z);
        p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        p.age += dt;
        if (t.y < -2) {                                          // rolled off the open edge of the room
          world.removeRigidBody(p.body);
          scene.remove(p.mesh);
          papers.splice(papers.indexOf(p), 1);
          break;
        }
        // in the bin: inside its radius, below the rim, and (almost) at rest
        if (!p.scored && Math.hypot(t.x - binPos.x, t.z - binPos.z) < BIN_INNER_R
            && t.y < binPos.y + BIN_H && t.y > binPos.y) {
          const v = p.body.linvel();
          if (Math.hypot(v.x, v.y, v.z) < 0.3) {
            p.scored = true;
            onScore(++scored);
          }
        }
      }
    },
  };
};
