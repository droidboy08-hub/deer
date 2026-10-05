// Content half of the "VitrePage" window actor: the host for page-side modules.
// It carries no feature logic itself; see page-api.ts for the module contract.
//
// Loaded by Gecko from chrome://vitre/content/actors/VitrePageChild.sys.mjs in every process that
// hosts a tab's document. The file must be readable by sandboxed content processes, which is why
// the package lives inside the runtime directory (or <profile>\chrome), see ARCHITECTURE.md.
// The actor name fixes the export name (VitrePageChild).
import { discovered } from './page/_generated';
import { FROM_PAGE, TO_PAGE, type PageContext, type PageEnvelope } from './page-api';

/** Merge two modules' options for the same event: the listener must satisfy both. */
function mergeOptions(a: Record<string, any> | undefined, b: Record<string, any>): Record<string, any> {
  if (!a) return { ...b };
  const out: Record<string, any> = {};
  if (a.capture || b.capture) out.capture = true;
  if (a.mozSystemGroup || b.mozSystemGroup) out.mozSystemGroup = true;
  if (a.wantUntrusted || b.wantUntrusted) out.wantUntrusted = true;
  if (a.passive && b.passive) out.passive = true;
  if (a.createActor === false && b.createActor === false) out.createActor = false;
  return out;
}

/** Every event some page module listens for. VitreStartup registers the actor with these. */
export const PAGE_EVENTS: Record<string, object> = {};
for (const { module } of discovered) {
  for (const [type, options] of Object.entries(module.events ?? {})) {
    PAGE_EVENTS[type] = mergeOptions(PAGE_EVENTS[type], options as Record<string, any>);
  }
}

export class VitrePageChild extends JSWindowActorChild {
  #contexts = new Map<string, PageContext>();
  #gone = false;

  #ctx(name: string): PageContext {
    let ctx = this.#contexts.get(name);
    if (!ctx) {
      const actor = this;
      ctx = {
        actor,
        state: {},
        get window() {
          try {
            return actor.contentWindow;
          } catch {
            return null;
          }
        },
        get document() {
          try {
            return actor.document;
          } catch {
            return null;
          }
        },
        get isTop() {
          try {
            const bc = actor.browsingContext;
            return !!bc && bc === bc.top;
          } catch {
            return false;
          }
        },
        send(message: string, data?: unknown) {
          if (actor.#gone) return;
          try {
            actor.sendAsyncMessage(FROM_PAGE, { name: message, data } satisfies PageEnvelope);
          } catch {
            // The actor was destroyed between the event and the send.
          }
        },
      };
      this.#contexts.set(name, ctx);
    }
    return ctx;
  }

  handleEvent(event: Event): void {
    for (const { name, module } of discovered) {
      if (!module.onEvent || !module.events || !(event.type in module.events)) continue;
      try {
        module.onEvent(this.#ctx(name), event);
      } catch (e) {
        console.error(`Deer page module ${name} failed on ${event.type}`, e);
      }
    }
  }

  receiveMessage(msg: ActorMessage): unknown {
    if (msg?.name !== TO_PAGE) return undefined;
    const envelope = msg.data as Partial<PageEnvelope> | null;
    if (!envelope || typeof envelope !== 'object' || typeof envelope.name !== 'string') return undefined;
    const { name: message, data } = envelope;
    let answer: unknown;
    for (const { name, module } of discovered) {
      if (!module.onMessage) continue;
      try {
        const r = module.onMessage(this.#ctx(name), message, data);
        if (answer === undefined && r !== undefined) answer = r;
      } catch (e) {
        console.error(`Deer page module ${name} failed on message ${message}`, e);
      }
    }
    return answer;
  }

  didDestroy(): void {
    this.#gone = true;
    for (const { name, module } of discovered) {
      const ctx = this.#contexts.get(name);
      if (!ctx || !module.onDestroy) continue;
      try {
        module.onDestroy(ctx);
      } catch {
        /* the document is gone anyway */
      }
    }
    this.#contexts.clear();
  }
}
