// A system ES module singleton (one instance per process), like the download engine will be.
let count = 0;
const events = [];
const waiters = [];

export const VitreProbe = {
  version: 1,
  url: import.meta.url,
  hasServices: typeof Services !== "undefined",
  processType: Services.appinfo.processType,
  bump() {
    return ++count;
  },
  record(e) {
    events.push(e);
    for (const w of waiters.splice(0)) w(e);
  },
  events,
  next() {
    return new Promise((r) => waiters.push(r));
  },
};
