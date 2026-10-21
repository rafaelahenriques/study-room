import * as THREE from 'three/webgpu';

/**
 * The mug's rim in world space, found from its geometry: the centre is the average of the
 * highest vertices (the rim is a ring, so the handle doesn't pull it sideways), the radius is
 * the inner edge of that ring. Follows the mug wherever it was moved in Blender.
 */
export const mugRim = (mug: THREE.Mesh): { centre: THREE.Vector3; radius: number } => {
  mug.updateWorldMatrix(true, false);
  const pos = mug.geometry.getAttribute('position');
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mug.matrixWorld));
  const top = Math.max(...pts.map((p) => p.y));
  const rim = pts.filter((p) => p.y > top - 0.002);
  const centre = rim.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(rim.length);
  const radius = Math.min(...rim.map((p) => Math.hypot(p.x - centre.x, p.z - centre.z)));
  return { centre, radius };
};
