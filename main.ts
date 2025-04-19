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
  const notExistedDirs = await getNotExistedDirs(new Set(filesToCopy.values().map((c) => c.to)));

  if (filesToCopy.size == 0 && filesToDelete.size == 0) {
    console.log("\t\tAlready synchronized -> Skip!");
    return;
  }

  console.log(
    `\t\tSyncing (fromFiles-${fromFiles.size} toCopy-${filesToCopy.size} toDelete-${filesToDelete.size})`
  );
  let lastMessage = "";

  if (notExistedDirs.size > 0) {
    let iterator = 0;
    for (const el of notExistedDirs) {
      try {
        lastMessage = await printInline(
          `\t\tAllocate directories [${Math.round(100 * ++iterator / notExistedDirs.size)}%]`, 
          lastMessage
        );
        await Deno.mkdir(el, { recursive: true });
      } catch (error) {
        console.error("\nCreate directory error: ", el, error);
      }
    }
    console.log();
  }
  

  if (filesToCopy.size > 0) {
    let iterator = 0;
    for (const el of filesToCopy) {
      try {
        lastMessage = await printInline(
          `\t\tCopy files           [${Math.round(100 * ++iterator / filesToCopy.size)}%]`, 
          lastMessage
        );
        await copy(el.from, el.to, { overwrite: true });
      } catch (error) {
        console.error("\nCopy file error: ", el.from, el.to, error);
      }
    }
    console.log();
  }

  if (filesToDelete.size > 0) {
    let iterator = 0;
    for (const el of filesToDelete) {
      try {
        lastMessage = await printInline(
          `\t\tRemove files         [${Math.round(100 * ++iterator / filesToDelete.size)}%]`, 
          lastMessage
        );
        await removeFileAndEmptyDir(el.to);
      } catch (error) {
        console.error("\nRemove file error: ", el.to, error);
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

  if (filesInDir.size == 0) 
    await Deno.remove(dirPath, { recursive: true });
}

function getFilesToDelete(
  config: Config,
  fromFiles: Set<string>,
  toFiles: Set<string>,
): Set<Config> {
  const fromFilesRelativePaths = new Set(fromFiles.values().map((file) =>
    getRelativePath(config.from, file)
  ));

  const filesToDelete: Set<Config> = new Set<Config>();

  for (const file of toFiles) {
    const fileRelativePath = getRelativePath(config.to, file);

    if (!fromFilesRelativePaths.has(fileRelativePath)) {
      filesToDelete.add({
        from: "",
        to: file,
        result: "file not exsists in source",
      });
    }
  }

  return filesToDelete;
}

async function getFilesToCopy(
  config: Config,
  fromFiles: Set<string>,
  toFiles: Set<string>,
): Promise<Set<Config>> {
  const toFilesRelativePaths = new Set(toFiles.values().map((file) =>
    getRelativePath(config.to, file)
  ));

  const filesToCopy: Set<Config> = new Set<Config>();

  for (const file of fromFiles.values()) {
    const fileRelativePath = getRelativePath(config.from, file);

    if (!toFilesRelativePaths.has(fileRelativePath)) {
      filesToCopy.add({
        from: file,
        to: config.to + fileRelativePath,
        result: "copy - file not exist in destination",
      });
    } else if (
      (await Deno.stat(file)).size !==
      (await Deno.stat(config.to + fileRelativePath)).size
    ) {
      filesToCopy.add({
        from: file,
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

function expandEnvironmentVariables(path: string, divider: string, variableMarker: string): string {
  if(!path.includes(variableMarker))
    return path;
  
  const variableNames = path.split(divider);
  path = "";

  for(const name of variableNames) {
    path += 
      (name.includes(variableMarker) ? 
        Deno.env.get(name.replaceAll(variableMarker, "")) :
        name) + divider
  }

  path = path.slice(0, path.length-1)
  
  return path;
}

async function getCleanPath(path: string): Promise<string> {
  const wrongDivider = "\\";
  const conventDivider = "/";

  path = path.replaceAll(wrongDivider, conventDivider);
  path = expandEnvironmentVariables(path, conventDivider, "%")
          .replaceAll(wrongDivider, conventDivider);

  if (
      await exists(path) && 
      (await Deno.stat(path)).isDirectory && 
      path.at(-1) !== conventDivider
    ) path += conventDivider;

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
): Promise<Set<string>> {
  const files = new Set<string>();
  if ((await Deno.stat(path)).isDirectory && await exists(path)) {
    for await (const walkEntry of walk(path)) {
      if (walkEntry.isFile) {
        files.add(await getCleanPath(walkEntry.path));
      }
    }
  }

  return files;
}

async function getNotExistedDirs(files: Set<string>): Promise<Set<string>> {
  const notExistedDirs : Set<string> = new Set<string>();

  for (const file of files) {
    const dir = file.slice(0, file.lastIndexOf("/"));

    if (!(await exists(dir))) {
      notExistedDirs.add(dir);
    }
  }

  return notExistedDirs;
}

if (import.meta.main) {
  const startTime = Date.now();
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

  const timeSpan = (Date.now() - startTime);
  const minutes = Math.floor(timeSpan / (1000 * 60));
  const seconds = (timeSpan - minutes * (1000 * 60))/1000;
  console.log(`\n\nCompleted in ${minutes}min ${seconds}sec\n\n`);

  if (!fromCLI) {
    alert("Press enter to exit...");
  }
}
