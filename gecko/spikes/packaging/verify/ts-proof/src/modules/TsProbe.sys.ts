// TypeScript source of a system module. esbuild strips the types; one .ts file -> one .sys.mjs file
// (no bundling), so module identity and chrome:// import URLs stay exactly as written.
import { VitreProbe } from "chrome://vitre/content/modules/VitreProbe.sys.mjs";

interface Download {
  id: number;
  url: string;
  bytes: number;
}

const queue: Download[] = [];

export const TsProbe = {
  add(url: string, bytes: number): Download {
    const d: Download = { id: queue.length + 1, url, bytes };
    queue.push(d);
    return d;
  },
  total(): number {
    return queue.reduce((n, d) => n + d.bytes, 0);
  },
  sharesSingleton(): boolean {
    return typeof VitreProbe.bump() === "number";
  },
};
