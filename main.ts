import { exists } from "jsr:@std/fs/exists";
import { walk } from "jsr:@std/fs/walk";
import { copy } from "jsr:@std/fs/copy";

interface Config {
  from: string;
  to: string;
  result: string;
}

const textEncoder = new TextEncoder();

export async function testSyncDirectories(
  from: string,
  to: string,
): Promise<void> {
  return await syncDirectories({
    from: from,
    to: to,
    result: "run from tests",
  });
}

async function syncDirectories(config: Config): Promise<void> {
  if (!await exists(config.from)) {
    console.error(`${config.from} not exists`);
    Deno.exit(1);
  } else if (!await exists(config.to)) {
    await Deno.mkdir(config.to, { recursive: true });
    config.to = await getCleanPath(config.to);
  }

  console.log(
    `\nSync\n\tFrom: ${config.from}\n\tTo:   ${config.to}\n\n\t\tCalculate difference...`,
  );

  const fromFiles = await getFilePathsFromDirRecursively(config.from);
  const toFiles = await getFilePathsFromDirRecursively(config.to);

  const filesToCopy = await getFilesToCopy(config, fromFiles, toFiles);
  const filesToDelete = getFilesToDelete(config, fromFiles, toFiles);
  const notExistedDirs = await getNotExistedDirs(filesToCopy.map((c) => c.to));

  if (filesToCopy.length == 0 && filesToDelete.length == 0)
    return;

  console.log(
    `\t\tSyncing (fromFiles-${fromFiles.length} toCopy-${filesToCopy.length} toDelete-${filesToDelete.length})`
  );
  let lastMessage = "";

  if (notExistedDirs.length > 0) {
    let iterator = 0;
    for (const i in notExistedDirs) {
      try {
        lastMessage = await printInline(
          `\t\tAllocate directories [${Math.round(100 * ++iterator / notExistedDirs.length)}]`, 
          lastMessage
        );
        await Deno.mkdir(notExistedDirs[i], { recursive: true });
      } catch (error) {
        console.error("Create directory error: ", notExistedDirs[i], error);
      }
    }
    console.log();
  }
  

  if (filesToCopy.length > 0) {
    let iterator = 0;
    for (const i in filesToCopy) {
      try {
        lastMessage = await printInline(
          `\t\tCopy files [${Math.round(100 * ++iterator / filesToCopy.length)}]`, 
          lastMessage
        );
        await copy(filesToCopy[i].from, filesToCopy[i].to, {
          overwrite: true,
          preserveTimestamps: true,
        });
      } catch (error) {
        console.error("Copy file error: ", filesToCopy[i].from, filesToCopy[i].to, error);
      }
    }
    console.log();
  }

  if (filesToDelete.length > 0) {
    let iterator = 0;
    for (const i in filesToDelete) {
      try {
        lastMessage = await printInline(
          `\t\tRemove files [${Math.round(100 * ++iterator / filesToDelete.length)}]`, 
          lastMessage
        );
        await removeFileAndEmptyDir(filesToDelete[i].to);
      } catch (error) {
        console.error("Remove file error: ", filesToDelete[i].to, error);
      }
    }
    console.log();
  }
}

async function printInline(message:string, lastMessage:string):Promise<string> {
  await Deno.stdout.write(textEncoder.encode("\r".repeat(lastMessage.length)))
  await Deno.stdout.write(textEncoder.encode(message));
  return message;
}

async function removeFileAndEmptyDir(path: string): Promise<void> {
  await Deno.remove(path);

  const dirPath = path.slice(0, path.lastIndexOf("/"));
  const filesInDir = await getFilePathsFromDirRecursively(dirPath);

  if (filesInDir.length == 0) 
    await Deno.remove(dirPath, { recursive: true });
}

function getFilesToDelete(
  config: Config,
  fromFiles: Array<string>,
  toFiles: Array<string>,
): Array<Config> {
  const fromFilesRelativePaths = fromFiles.map((file) =>
    getRelativePath(config.from, file)
  );

  const filesToDelete: Array<Config> = [];

  for (const i in toFiles) {
    const fileRelativePath = getRelativePath(config.to, toFiles[i]);

    if (!fromFilesRelativePaths.includes(fileRelativePath)) {
      filesToDelete.push({
        from: "",
        to: toFiles[i],
        result: "file not exsists in source",
      });
    }
  }

  return filesToDelete;
}

async function getFilesToCopy(
  config: Config,
  fromFiles: Array<string>,
  toFiles: Array<string>,
): Promise<Array<Config>> {
  const toFilesRelativePaths = toFiles.map((file) =>
    getRelativePath(config.to, file)
  );

  const filesToCopy: Array<Config> = [];

  for (const i in fromFiles) {
    const fileRelativePath = getRelativePath(config.from, fromFiles[i]);

    if (!toFilesRelativePaths.includes(fileRelativePath)) {
      filesToCopy.push({
        from: fromFiles[i],
        to: config.to + fileRelativePath,
        result: "copy - file not exist in destination",
      });
    } else if (
      (await Deno.stat(fromFiles[i])).size !==
      (await Deno.stat(config.to + fileRelativePath)).size
    ) {
      filesToCopy.push({
        from: fromFiles[i],
        to: config.to + fileRelativePath,
        result: "copy - bytes not match",
      });
    }
  }

  return filesToCopy;
}

function getRelativePath(base: string, path: string): string {
  const relativePath = path.replace(base, "");

  return relativePath;
}

async function getCleanPath(path: string): Promise<string> {
  const wrongDivider = "\\";
  const conventDivider = "/";

  path = path.replaceAll(wrongDivider, conventDivider);

  if (
    await exists(path) && (await Deno.stat(path)).isDirectory &&
    path.at(-1) !== conventDivider
  ) {
    path += conventDivider;
  }

  return path;
}

async function getConfigs(): Promise<Array<Config>> {
  let syncConfigPath = Deno.cwd() + "/syncConfig.json";

  if (!await exists(syncConfigPath)) {
    await Deno.writeTextFile(
      syncConfigPath,
      '[{"form":"formPath","to":"toPath"}]',
    );
  }

  syncConfigPath = await getCleanPath(syncConfigPath);

  const configs = JSON.parse(await Deno.readTextFile(syncConfigPath)) as Array<
    Config
  >;

  for (const i in configs) {
    configs[i].from = await getCleanPath(configs[i].from);
    configs[i].to = await getCleanPath(configs[i].to);
  }

  return configs;
}

function validateConfigs(syncConfig: object): void {
  if (!Array.isArray(syncConfig)) {
    console.error("wrong struct of syncConfig.json");
    Deno.exit(2);
  }

  if (syncConfig.length == 0) {
    console.error("syncConfig.json is empty!");
    Deno.exit(3);
  }
}

function getSyncPromise(el: Config): Promise<void> {
  if (el === null) {
    return Promise.resolve();
  }

  return syncDirectories(el);
}

async function getFilePathsFromDirRecursively(
  path: string,
): Promise<Array<string>> {
  const files = [];
  if ((await Deno.stat(path)).isDirectory && await exists(path)) {
    for await (const walkEntry of walk(path)) {
      if (walkEntry.isFile) {
        files.push(await getCleanPath(walkEntry.path));
      }
    }
  }

  return files;
}

async function getNotExistedDirs(files: Array<string>): Promise<Array<string>> {
  const notExistedDirs = [];

  for (const i in files) {
    const dir = files[i].slice(0, files[i].lastIndexOf("/"));

    if (!(await exists(dir))) {
      notExistedDirs.push(dir);
    }
  }

  return notExistedDirs;
}

if (import.meta.main) {
  let syncConfigs = [] as Array<Config>;
  let fromCLI = false;

  if (Deno.args[0] === undefined && Deno.args[1] === undefined) {
    syncConfigs = await getConfigs();
  } else {
    syncConfigs = [
      {
        from: await getCleanPath(Deno.args[0]),
        to: await getCleanPath(Deno.args[1]),
        result: "run from CLI",
      },
    ];
    fromCLI = true;
  }

  validateConfigs(syncConfigs);

  for (const i in syncConfigs) {
    await getSyncPromise(syncConfigs[i]);
  }

  console.log("\n\nComplete!\n\n");

  if (!fromCLI) {
    while (prompt("Press enter to exit...", "") != "");
  }
}
