// The other modules' services this module uses. They are typed by the providers' own declarations
// (VitreServices: menus/types.ts MenusApi, settings/index.ts SettingsApi), so a change of contract
// fails tsc here, and looked up by name at the moment of use (b.service), never at install: a build
// may leave the menus or settings module out, and every caller copes with their absence.
import type { Browser } from '../../browser';
import type { MenuItem } from '../menus/types';

/** One row of the 'menus' service. */
export type MenuRow = MenuItem;
export type MenusService = VitreServices['menus'];
export type SettingsService = VitreServices['settings'];
export type SettingsPageDef = Parameters<SettingsService['registerPage']>[0];

/** A service another module provides, or undefined (not in this build). */
export function service<K extends keyof VitreServices>(b: Browser, name: K): VitreServices[K] | undefined {
  try {
    return b.service(name);
  } catch {
    return undefined;
  }
}

/** Resolves when another module provides a service (never, when it is not in this build). */
export function whenService<K extends keyof VitreServices>(b: Browser, name: K): Promise<VitreServices[K]> {
  return b.whenService(name);
}

export const SEP: MenuRow = { separator: true };

/** A label from an extension or an add-on name: '&' is literal in the menus service only as '&&'. */
export const literal = (text: string): string => text.replace(/&/g, '&&');
