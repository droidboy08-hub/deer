import type { Tab } from '../../model';
import type { Media } from './parts';
import type { Match } from './search';

export type Style = 'deck' | 'grid' | 'strip';

/** The switcher session that every view reads. The controller owns and changes it. */
export interface Model {
  /** Every tab in switcher order (most recent first, or tab-bar order). */
  all: number[];
  /** The tabs shown: all of them, or the ones matching the query. */
  list: number[];
  /** Index into list of the selected card; -1 when nothing matches. */
  sel: number;
  /** The tab that was active when the switcher opened. */
  startId: number;
  query: string;
  /** Latched: stays open with Ctrl up (Enter opens, Esc cancels). */
  latched: boolean;
  tab(id: number): Tab | undefined;
  match(id: number): Match | null;
  /**
   * Paint the tab's picture into a card's media (thumbs.ts). Cheap when nothing changed since the
   * last paint. A picture that must be decoded first arrives later through View.refresh(id).
   */
  paint(id: number, media: Media): void;
}

/** What a view asks the controller to do (mouse input). */
export interface ViewHandlers {
  select(id: number): void;
  open(id: number): void;
  close(id: number): void;
  cancel(): void;
  newTab(): void;
}

export interface View {
  readonly root: HTMLElement;
  /** Puts the shared search row (icon, input, count) into the view's field. */
  mount(fieldRow: HTMLElement): void;
  /** Plays the opening motion. Call once, after the root is in the document. */
  enter(): void;
  /** Selection, list, query or latched state changed. */
  update(): void;
  /** A tab's title, favicon or thumbnail changed. */
  refresh(id: number): void;
  /** The next update removes this card because it was closed (lift and fade). */
  closing(id: number): void;
  /** The chosen card grows to fill the window; resolves when it has. */
  expand(id: number): Promise<void>;
  /** The window was resized. */
  layout(): void;
  /** Cards per row, for Up and Down in the grid. */
  columns(): number;
  /** Tabs whose cards are on screen now, nearest the selection first (fresh thumbnails go there first). */
  visible(): number[];
}
