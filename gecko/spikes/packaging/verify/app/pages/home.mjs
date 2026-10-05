import { helper } from "chrome://vitre/content/chrome/helper.mjs";
window.vitreHomeModuleProbe = helper();
const p = document.createElement("p");
p.textContent = "home.mjs (type=module): " + helper();
document.querySelector("main").append(p);
