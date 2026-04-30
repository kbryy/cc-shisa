import { expect, test } from "bun:test";

import { VERSION } from "../src/version.ts";

test("VERSION is a non-empty semver-shaped string", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
});
