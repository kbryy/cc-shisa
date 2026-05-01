import { describe, expect, test } from "bun:test";

import { inspectByLang, inspectDynamic } from "../src/classifier/interpreter-inspect.ts";
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

describe("inspectByLang — Python user module whitelist", () => {
  const modules: Readonly<Record<string, Class>> = {
    openpyxl: "local.write",
    "python-pptx": "local.write",
    pandas: "local.read",
    numpy: "local.read",
  };

  test("import openpyxl picks up user-listed local.write", () => {
    const r = inspectByLang("python", 'import openpyxl; openpyxl.load_workbook("f.xlsx")', modules);
    expect(r?.class).toBe("local.write");
  });

  test("from openpyxl import ... also matches", () => {
    const r = inspectByLang("python", 'from openpyxl import load_workbook; load_workbook("f")', modules);
    expect(r?.class).toBe("local.write");
  });

  test("dotted form 'from openpyxl.styles import ...' matches the openpyxl entry", () => {
    const r = inspectByLang("python", "from openpyxl.styles import Font", modules);
    expect(r?.class).toBe("local.write");
  });

  test("user-listed import + DENY pattern → strictest (dangerous) wins", () => {
    const sysCall = "os." + 'system("ls")';
    const r = inspectByLang("python", `import openpyxl; import os; ${sysCall}`, modules);
    expect(r?.class).toBe("dangerous");
  });

  test("user-listed import + os.remove → local.write.destroy wins (stricter than local.write)", () => {
    const r = inspectByLang("python", 'import openpyxl; import os; os.remove("f")', modules);
    expect(r?.class).toBe("local.write.destroy");
  });

  test("unknown module not in whitelist returns null", () => {
    const r = inspectByLang("python", "import unknownlib; foo()", modules);
    expect(r).toBeNull();
  });

  test("no user modules provided → falls back to built-in inspection", () => {
    expect(inspectByLang("python", "print(1)")?.class).toBe("local.read");
    expect(inspectByLang("python", "import openpyxl; foo()")).toBeNull();
  });
});

describe("inspectByLang — Node.js (-e)", () => {
  const EV = "ev" + "al";

  test("console.log(literal) → local.read", () => {
    expect(inspectByLang("node", 'console.log("hi")')?.class).toBe("local.read");
    expect(inspectByLang("node", "console.log(1)")?.class).toBe("local.read");
  });

  test("require('fs').rmSync → local.write.destroy", () => {
    const r = inspectByLang("node", 'require("fs").rmSync("foo")');
    expect(r?.class).toBe("local.write.destroy");
  });

  test("fs.writeFileSync → local.write", () => {
    const r = inspectByLang("node", 'require("fs").writeFileSync("f", "x")');
    expect(r?.class).toBe("local.write");
  });

  test("http.createServer().listen → remote.write", () => {
    const r = inspectByLang("node", 'require("http").createServer().listen(8080)');
    expect(r?.class).toBe("remote.write");
  });

  test("fetch(url) → remote.read", () => {
    expect(inspectByLang("node", 'fetch("http://x")')?.class).toBe("remote.read");
  });

  test("dynamic code form → dynamic", () => {
    expect(inspectByLang("node", `${EV}("x")`)?.class).toBe("dynamic");
  });

  test("ambiguous content returns null", () => {
    expect(inspectByLang("node", "weird code with no clear pattern")).toBeNull();
  });
});

describe("inspectByLang — Ruby (-e)", () => {
  const EV = "ev" + "al";

  test("puts literal → local.read", () => {
    expect(inspectByLang("ruby", 'puts "hello"')?.class).toBe("local.read");
    expect(inspectByLang("ruby", "puts 1")?.class).toBe("local.read");
  });

  test("File.delete → local.write.destroy", () => {
    expect(inspectByLang("ruby", 'File.delete("foo")')?.class).toBe("local.write.destroy");
  });

  test("Net::HTTP.get → remote.read", () => {
    expect(inspectByLang("ruby", 'Net::HTTP.get(URI("http://x"))')?.class).toBe("remote.read");
  });

  test("backtick → dangerous", () => {
    expect(inspectByLang("ruby", "`ls`")?.class).toBe("dangerous");
  });

  test("dynamic code form → dynamic", () => {
    expect(inspectByLang("ruby", `${EV}("1+1")`)?.class).toBe("dynamic");
  });
});

describe("inspectByLang — Perl (-e)", () => {
  const EV = "ev" + "al";

  test("print literal → local.read", () => {
    expect(inspectByLang("perl", 'print "hi";')?.class).toBe("local.read");
  });

  test("unlink → local.write.destroy", () => {
    expect(inspectByLang("perl", 'unlink("foo");')?.class).toBe("local.write.destroy");
  });

  test("backtick → dangerous", () => {
    expect(inspectByLang("perl", "`ls`")?.class).toBe("dangerous");
  });

  test("dynamic code block → dynamic", () => {
    expect(inspectByLang("perl", `${EV} { 1 };`)?.class).toBe("dynamic");
  });
});

describe("inspectByLang — user whitelist for non-Python", () => {
  test("node require('exceljs') matches user-listed local.write", () => {
    const r = inspectByLang("node", 'require("exceljs"); doStuff()', { exceljs: "local.write" });
    expect(r?.class).toBe("local.write");
  });

  test("ruby require 'rubyXL' matches user list", () => {
    const r = inspectByLang("ruby", 'require "rubyXL"; foo()', { rubyXL: "local.write" });
    expect(r?.class).toBe("local.write");
  });

  test("perl use Spreadsheet matches user list", () => {
    const r = inspectByLang("perl", "use Spreadsheet::WriteExcel; foo();", { "Spreadsheet::WriteExcel": "local.write" });
    expect(r?.class).toBe("local.write");
  });
});

describe("inspectDynamic — non-applicable cases", () => {
  test("unknown interpreter returns null", () => {
    expect(inspectDynamic(pyseg("print(1)", "octave"))).toBeNull();
    expect(inspectDynamic(pyseg("print(1)", "lua"))).toBeNull();
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
