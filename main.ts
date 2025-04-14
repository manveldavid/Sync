import { exists } from "jsr:@std/fs/exists"
import { walk } from "jsr:@std/fs/walk"
import { copy } from "jsr:@std/fs/copy"

interface Config {
  from: string;
  to: string;
  result: string;
}

export async function testSyncDirectories(from:string, to:string) : Promise<void> {
  return await syncDirectories({
    from: from,
    to: to,
    result: "run from tests"
  });
}

async function syncDirectories(config : Config) : Promise<void> {
  if(!await exists(config.from)) {
    console.error(`${config.from} not exists`);
    Deno.exit(1);
  } else if(!await exists(config.to)) {
    await Deno.mkdir(config.to, {recursive:true});
    config.to = await getCleanPath(config.to);
  }
  
  console.log(`\nSync\n\tFrom: ${config.from}\n\tTo:   ${config.to}\n\n\t\tCalculate difference...`)

  const fromFiles = await getFilePathsFromDirRecursively(config.from);
  const toFiles = await getFilePathsFromDirRecursively(config.to);
  
  const filesToCopy = await getFilesToCopy(config, fromFiles, toFiles);
  const filesToDelete = getFilesToDelete(config, fromFiles, toFiles);
  const notExistedDirs = await getNotExistedDirs(filesToCopy.map(c => c.to))
  
  console.log(`\t\t(fromFiles-${fromFiles.length} toCopy-${filesToCopy.length} toDelete-${filesToDelete.length})`);
  console.log("\t\tSyncing...")

  if(notExistedDirs.length > 0) {
    console.log("\t\tAllocate directories...")
    await Promise.all(
      notExistedDirs.map(d => {
        try {
          return Deno.mkdir(d, { recursive:true });
        } catch(error) {
          console.error("Create directory error: ", d, error)
          return Promise.resolve();
        }
      }));
  }

  if(filesToCopy.length > 0) {
    console.log("\t\tCopy files...")
    await Promise.all(
      filesToCopy.map(c => {
        try {
          console.log(`\t\t\t${c.to}`);
          return copy(c.from, c.to, { overwrite: true, preserveTimestamps: true });
        } catch(error){
          console.error("Copy file error: ", c.from, c.to, error)
          return Promise.resolve();
        }
      }));
  }
  
  if(filesToDelete.length > 0) {
    console.log("\t\tRemove files...")
    await Promise.all(filesToDelete.map(c => {
      try{
        console.log(`\t\t\t${c.to}`);
        return Deno.remove(c.to);
      }
      catch(error){
        console.error("Remove file error: ", c.to, error)
        return Promise.resolve();
      }
    } ));
  }

  console.log("\t\tFind empty dirs...")
  const emptyDirs = await getEmpryDirs(config.to);

  if(emptyDirs.length > 0){
    console.log("\t\tRemove empty dirs...")
    await Promise.all(emptyDirs.map(d => {
      try{
        console.log(`\t\t\t${d}`);
        return Deno.remove(d, {recursive: true});
      }
      catch(error){
        console.error("Remove empty dir error: ", d, error)
        return Promise.resolve();
      }
    } ));
  }
}

function getFilesToDelete(config:Config, fromFiles:Array<string>, toFiles: Array<string>) : Array<Config> {
  const fromFilesRelativePaths = fromFiles.map(file => getRelativePath(config.from, file));

  const filesToDelete : Array<Config> = [];

  for(const i in toFiles){
    const fileRelativePath = getRelativePath(config.to, toFiles[i]);

    if(!fromFilesRelativePaths.includes(fileRelativePath)){
      filesToDelete.push({
        from: "",
        to: toFiles[i],
        result: "file not exsists in source"
      })
    }
  }

  return filesToDelete;
}

async function getFilesToCopy(config : Config, fromFiles:Array<string>, toFiles: Array<string>) : Promise<Array<Config>> {
  const toFilesRelativePaths = toFiles.map(file => getRelativePath(config.to, file));

  const filesToCopy : Array<Config> = [];

  for(const i in fromFiles){
    const fileRelativePath = getRelativePath(config.from, fromFiles[i]);

    if(!toFilesRelativePaths.includes(fileRelativePath)){
      filesToCopy.push({
        from: fromFiles[i],
        to: config.to + fileRelativePath,
        result: "copy - file not exist in destination"
      });
    } else if((await Deno.stat(fromFiles[i])).size !== (await Deno.stat(config.to + fileRelativePath)).size){
      filesToCopy.push({
        from: fromFiles[i],
        to: config.to + fileRelativePath,
        result: "copy - bytes not match"
      });
    }
  }
  
  return filesToCopy;
}

function getRelativePath(base:string, path:string) : string {
  const relativePath = path.replace(base, "");

  return relativePath;
}

async function getCleanPath(path:string):Promise<string>{
  const wrongDivider = "\\";
  const conventDivider = "/";

  path = path.replaceAll(wrongDivider, conventDivider);
  
  if(await exists(path) && (await Deno.stat(path)).isDirectory && path.at(-1) !== conventDivider)
    path += conventDivider;

  return path;
}

async function getConfigs() : Promise<Array<Config>> {
  let syncConfigPath = Deno.cwd() + "/syncConfig.json";
  
  if(!await exists(syncConfigPath))
    await Deno.writeTextFile(syncConfigPath, '[{"form":"formPath","to":"toPath"}]');

  syncConfigPath = await getCleanPath(syncConfigPath);

  const configs = JSON.parse((await Deno.readTextFile(syncConfigPath))) as Array<Config>;
  
  for(const i in configs) {
    configs[i].from = await getCleanPath(configs[i].from);
    configs[i].to = await getCleanPath(configs[i].to);
  }

  return configs;
}

function validateConfigs(syncConfig : object) : void{
  if(!Array.isArray(syncConfig)){
    console.error("wrong struct of syncConfig.json");
    Deno.exit(2);
  }

  if(syncConfig.length == 0) {
    console.error("syncConfig.json is empty!");
    Deno.exit(3);
  }
}

function getSyncPromise(el : Config): Promise<void> {
  if(el === null)
    return Promise.resolve();

  return syncDirectories(el);
}

async function getFilePathsFromDirRecursively(path:string) : Promise<Array<string>> {
  const files = [];

  for await (const walkEntry of walk(path))
    if(walkEntry.isFile)
      files.push(await getCleanPath(walkEntry.path));

  return files;
}

async function getDirsFromDirRecursively(path:string) : Promise<Array<string>> {
  const dirs = [];

  for await (const walkEntry of walk(path))
    if(walkEntry.isDirectory)
      dirs.push(await getCleanPath(walkEntry.path));

  return dirs;
}

async function getEmpryDirs(path:string) : Promise<Array<string>> {
  const dirs = await getDirsFromDirRecursively(path);
  const files = await getFilePathsFromDirRecursively(path);
  const emptyDirs = dirs.filter(d => !files.some(f => f.includes(d))).reverse();

  return emptyDirs;
}

async function getNotExistedDirs(files:Array<string>) : Promise<Array<string>> {
  const notExistedDirs = [];

  for(const i in files) {
    const dir = files[i].slice(0, files[i].lastIndexOf("/"));

    if(!(await exists(dir)))
      notExistedDirs.push(dir);
  }
  
  return notExistedDirs;
}

if (import.meta.main) {
  let syncConfigs = [] as Array<Config>

  if(Deno.args[0] === undefined && Deno.args[1] === undefined)
    syncConfigs = await getConfigs();
  else
    syncConfigs = [
      {
        from: await getCleanPath(Deno.args[0]),
        to: await getCleanPath(Deno.args[1]),
        result: "run from CLI"
      }
    ]

  validateConfigs(syncConfigs);

  for(const i in syncConfigs)
    await getSyncPromise(syncConfigs[i]);
  
  console.log("Press enter to exit...");
  await Deno.stdin.read(new Uint8Array(1));
}
