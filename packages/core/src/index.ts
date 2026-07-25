// Superfície pública do núcleo compartilhado.
export * from "./idiomas.js";
export * from "./segments.js";
export * from "./ports.js";
export * from "./falantes.js";
export * from "./janelas.js";
export * from "./session/estado.js";
export * from "./vad.js";
export * from "./pipeline.js";
export * from "./export.js";
export * from "./ia.js";
export {
  novoId,
  concatPcm,
  paraInt16,
  paraFloat32,
  reamostrar,
} from "./util.js";
