import { VitreProbe } from "chrome://vitre/content/modules/VitreProbe.sys.mjs";
const queue = [];
const TsProbe = {
  add(url, bytes) {
    const d = { id: queue.length + 1, url, bytes };
    queue.push(d);
    return d;
  },
  total() {
    return queue.reduce((n, d) => n + d.bytes, 0);
  },
  sharesSingleton() {
    return typeof VitreProbe.bump() === "number";
  }
};
export {
  TsProbe
};
