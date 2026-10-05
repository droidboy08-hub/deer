// Loaded with <script type="module" src="chrome://vitre/content/probe.mjs"> inside browser.xhtml.
import { answer } from "chrome://vitre/content/probe2.mjs";
window.__vitreProbe = { answer, document: typeof document, gBrowser: typeof gBrowser, Services: typeof Services, ChromeUtils: typeof ChromeUtils };
