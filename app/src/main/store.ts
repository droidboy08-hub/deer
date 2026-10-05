import * as fs from 'fs';
import * as path from 'path';

/** A small JSON file with debounced, atomic writes. */
export class Store<T> {
  private value: T;
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string, fallback: T) {
    try {
      this.value = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      this.value = fallback;
    }
  }

  get(): T {
    return this.value;
  }

  set(value: T): void {
    this.value = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.value));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('store write failed', this.file, err);
    }
  }
}
