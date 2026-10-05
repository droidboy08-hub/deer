/* global ExtensionAPI, Services */
// Experiment API: privileged parent-process code exposed to the extension's own scripts.
this.vitreProbe = class extends ExtensionAPI {
  getAPI() {
    return {
      vitreProbe: {
        async whoami() {
          return "chrome code in " + Services.appinfo.name + " pid " + Services.appinfo.processID;
        },
      },
    };
  }
};
