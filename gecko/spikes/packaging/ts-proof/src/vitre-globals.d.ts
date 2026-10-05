// Minimal ambient declarations so `tsc --noEmit` accepts chrome:// imports in this proof.
// The real project should take Mozilla's generated Gecko typings (tools/@types in the Firefox tree).
declare module "chrome://vitre/content/modules/VitreProbe.sys.mjs" {
  export const VitreProbe: { bump(): number; version: number };
}
