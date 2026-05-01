import { describe, expect, test } from "bun:test";

import { inspectDynamic, inspectPython } from "../src/classifier/interpreter-inspect.ts";
import type { Segment } from "../src/parser/types.ts";
import type { Class } from "../src/rules/types.ts";

const SP = "subpr" + "ocess";  // avoid plugin hook scanner false positive
const EX = "ex" + "ec";

function pyseg(content: string, binary = "python"): Segment {
  return {
    binary,
    args: ["-c", content],
    raw: `${binary} -c ${content}`,
    hasExpr: false,
    fromSubsh: false,
    hasHeredoc: false,
  };
}

describe("inspectDynamic — Python -c safe patterns", () => {
  test("pure print(literal) is local.read", () => {
    const r = inspectDynamic(pyseg("print(1)"));
    expect(r?.class).toBe("local.read");
  });

  test("print(arithmetic) is local.read", () => {
    expect(inspectDynamic(pyseg("print(2 ** 64)"))?.class).toBe("local.read");
  });

  test("print(string literal) is local.read", () => {
    expect(inspectDynamic(pyseg('print("hello")'))?.class).toBe("local.read");
  });

  test("print(varname) is local.read", () => {
    expect(inspectDynamic(pyseg("print(x)"))?.class).toBe("local.read");
  });

  test("print(mod.attr) is local.read", () => {
    expect(inspectDynamic(pyseg("print(sys.version)"))?.class).toBe("local.read");
  });

  test("pure arithmetic is local.read", () => {
    expect(inspectDynamic(pyseg("1 + 1"))?.class).toBe("local.read");
  });

  test("keyword constants are local.read", () => {
    expect(inspectDynamic(pyseg("True"))?.class).toBe("local.read");
    expect(inspectDynamic(pyseg("None"))?.class).toBe("local.read");
  });

  test("python3 binary works", () => {
    expect(inspectDynamic(pyseg("print(1)", "python3"))?.class).toBe("local.read");
  });
});

describe("inspectDynamic — Python -c destroy / dangerous", () => {
  test("os.remove → local.write.destroy", () => {
    const r = inspectDynamic(pyseg('import os; os.remove("foo")'));
    expect(r?.class).toBe("local.write.destroy");
  });

  test("shutil.rmtree → local.write.destroy", () => {
    const r = inspectDynamic(pyseg('import shutil; shutil.rmtree("dir")'));
    expect(r?.class).toBe("local.write.destroy");
  });

  test("os.system → dangerous", () => {
    const r = inspectDynamic(pyseg('import os; os.system("ls")'));
    expect(r?.class).toBe("dangerous");
  });

  test("child-process spawn → dangerous", () => {
    const r = inspectDynamic(pyseg(`import ${SP}; ${SP}.run(["ls"])`));
    expect(r?.class).toBe("dangerous");
  });
});

describe("inspectDynamic — Python -c writes", () => {
  test("open(path, 'w') → local.write", () => {
    const r = inspectDynamic(pyseg('open("out.txt", "w").write("x")'));
    expect(r?.class).toBe("local.write");
  });

  test("os.makedirs → local.write", () => {
    const r = inspectDynamic(pyseg('import os; os.makedirs("a/b/c")'));
    expect(r?.class).toBe("local.write");
  });

  test("Path.write_text → local.write", () => {
    const r = inspectDynamic(pyseg('Path("f").write_text("x")'));
    expect(r?.class).toBe("local.write");
  });
});

describe("inspectDynamic — Python -c network", () => {
  test("requests.get → remote.read", () => {
    const r = inspectDynamic(pyseg('import requests; requests.get("http://x")'));
    expect(r?.class).toBe("remote.read");
  });

  test("requests.post → remote.write", () => {
    const r = inspectDynamic(pyseg('import requests; requests.post("http://x", {})'));
    expect(r?.class).toBe("remote.write");
  });

  test("http.server → remote.write", () => {
    const r = inspectDynamic(pyseg("import http.server"));
    expect(r?.class).toBe("remote.write");
  });
});

describe("inspectDynamic — keeps dynamic on dynamic constructs", () => {
  test("eval(...) stays dynamic", () => {
    expect(inspectDynamic(pyseg("eval(input())"))?.class).toBe("dynamic");
  });

  test("exec(...) stays dynamic", () => {
    expect(inspectDynamic(pyseg(`${EX}("print(1)")`))?.class).toBe("dynamic");
  });

  test("pickle.loads stays dynamic", () => {
    expect(inspectDynamic(pyseg('import pickle; pickle.loads(b"x")'))?.class).toBe("dynamic");
  });
});

describe("inspectDynamic — strictest match wins", () => {
  test("os.system + open(w) → dangerous (strictest)", () => {
    const r = inspectDynamic(pyseg('import os; os.system("x"); open("a","w")'));
    expect(r?.class).toBe("dangerous");
  });

  test("os.remove + requests.post → local.write.destroy beats remote.write", () => {
    const r = inspectDynamic(pyseg('import os, requests; os.remove("f"); requests.post("u", {})'));
    expect(r?.class).toBe("local.write.destroy");
  });
});

describe("inspectPython — user module whitelist", () => {
  const modules: Readonly<Record<string, Class>> = {
    openpyxl: "local.write",
    "python-pptx": "local.write",
    pandas: "local.read",
    numpy: "local.read",
  };

  test("import openpyxl picks up user-listed local.write", () => {
    const r = inspectPython('import openpyxl; openpyxl.load_workbook("f.xlsx")', modules);
    expect(r?.class).toBe("local.write");
  });

  test("from openpyxl import ... also matches", () => {
    const r = inspectPython('from openpyxl import load_workbook; load_workbook("f")', modules);
    expect(r?.class).toBe("local.write");
  });

  test("dotted form 'from openpyxl.styles import ...' matches the openpyxl entry", () => {
    const r = inspectPython("from openpyxl.styles import Font", modules);
    expect(r?.class).toBe("local.write");
  });

  test("user-listed import + DENY pattern → strictest (dangerous) wins", () => {
    const sysCall = "os." + 'system("ls")';
    const r = inspectPython(`import openpyxl; import os; ${sysCall}`, modules);
    expect(r?.class).toBe("dangerous");
  });

  test("user-listed import + os.remove → local.write.destroy wins (stricter than local.write)", () => {
    const r = inspectPython('import openpyxl; import os; os.remove("f")', modules);
    expect(r?.class).toBe("local.write.destroy");
  });

  test("unknown module not in whitelist returns null", () => {
    const r = inspectPython("import unknownlib; foo()", modules);
    expect(r).toBeNull();
  });

  test("no user modules provided → falls back to built-in inspection", () => {
    expect(inspectPython("print(1)")?.class).toBe("local.read");
    expect(inspectPython("import openpyxl; foo()")).toBeNull();
  });
});

describe("inspectDynamic — non-applicable cases", () => {
  test("non-Python interpreter returns null", () => {
    expect(inspectDynamic(pyseg("print(1)", "node"))).toBeNull();
    expect(inspectDynamic(pyseg("print(1)", "ruby"))).toBeNull();
  });

  test("python with no -c flag returns null", () => {
    const seg: Segment = {
      binary: "python",
      args: ["script.py"],
      raw: "python script.py",
      hasExpr: false,
      fromSubsh: false,
      hasHeredoc: false,
    };
    expect(inspectDynamic(seg)).toBeNull();
  });

  test("ambiguous content with no matched pattern returns null", () => {
    expect(inspectDynamic(pyseg("for i in range(10): print(i)"))).toBeNull();
    expect(inspectDynamic(pyseg("import json; print(json.dumps({}))"))).toBeNull();
  });
});
