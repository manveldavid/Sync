import { expect } from "jsr:@std/expect";
import { exists } from "jsr:@std/fs/exists";
import { testSyncDirectories } from "./main.ts";

Deno.test("copy test", async () => {
  await clearTestFileStruct();
  await createTestFileStruct();

  await testSyncDirectories("a", "b");

  expect(await Deno.readTextFile("b/a.txt")).toBe("hello");
  expect(await Deno.readTextFile("b/aa/aa.txt")).toBe("world");

  await clearTestFileStruct();
});

Deno.test("delete test", async () => {
  await clearTestFileStruct();
  await createTestFileStruct();

  await testSyncDirectories("b", "a");

  expect(await exists("a/a.txt")).toBe(false);
  expect(await exists("a/aa/aa.txt")).toBe(false);

  await clearTestFileStruct();
});

async function createTestFileStruct(): Promise<void> {
  await Deno.mkdir("a");
  await Deno.mkdir("a/aa");
  await Deno.writeTextFile("a/a.txt", "hello");
  await Deno.writeTextFile("a/aa/aa.txt", "world");
  await Deno.mkdir("b");
}

async function clearTestFileStruct() {
  if (await exists("a")) {
    await Deno.remove("a", { recursive: true });
  }

  if (await exists("b")) {
    await Deno.remove("b", { recursive: true });
  }
}
