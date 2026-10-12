const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async context => {
  const root = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin');
  const target = context.electronPlatformName;
  for (const platform of await fs.readdir(root)) {
    if (platform !== target) await fs.rm(path.join(root, platform), { recursive: true, force: true });
    else for (const arch of await fs.readdir(path.join(root, platform))) {
      if (arch !== 'x64') await fs.rm(path.join(root, platform, arch), { recursive: true, force: true });
    }
  }
};
