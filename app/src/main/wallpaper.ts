import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** The user's own Windows desktop wallpaper, used as Home's default background. */
export function findWallpaper(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true }, (err, stdout) => {
      const fromReg = !err ? /WallPaper\s+REG_SZ\s+(.+)/i.exec(stdout)?.[1]?.trim() : undefined;
      if (fromReg && fs.existsSync(fromReg)) return resolve(fromReg);
      const transcoded = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
      resolve(fs.existsSync(transcoded) ? transcoded : null);
    });
  });
}
