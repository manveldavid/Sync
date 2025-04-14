# Sync
this is a simpe app (cli also supported) to sync folders build with Deno

## Config
the first run creates config file (syncConfig.json)
enumerate "from" and "to" folders in the file

## Run
run `main.ts` by Deno in terminal
usage: `deno run -A ./main.ts`

## Build
create `Sync` executable file with a pretty icon
usage: `deno compile -A --icon ./icon.ico ./main.ts`

## Tests
there are two simple tests (copy and delete files)
usage: `deno test -A`

## CLI
sync `toPath` with `fromPath` as reference
usage: `./Sync.exe [fromPath] [toPath]`
