export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type Unsubscribe = () => void;

/** Unique across peers: `${peerId}:${localCounter}`. */
export type EntityId = string;
