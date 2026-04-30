import coreData from "./data/_core.json" with { type: "json" };
import coreutilsData from "./data/coreutils.json" with { type: "json" };
import gitData from "./data/git.json" with { type: "json" };
import ghData from "./data/gh.json" with { type: "json" };
import bunData from "./data/bun.json" with { type: "json" };
import npmData from "./data/npm.json" with { type: "json" };
import pnpmData from "./data/pnpm.json" with { type: "json" };
import yarnData from "./data/yarn.json" with { type: "json" };
import dockerData from "./data/docker.json" with { type: "json" };
import kubectlData from "./data/kubectl.json" with { type: "json" };
import cargoData from "./data/cargo.json" with { type: "json" };
import brewData from "./data/brew.json" with { type: "json" };
import defaultProfileData from "./data/profiles/default.json" with { type: "json" };

export const MANDATORY_MODULE = "_core";

export const BUILTIN_MODULES: Readonly<Record<string, unknown>> = {
  _core: coreData,
  coreutils: coreutilsData,
  git: gitData,
  gh: ghData,
  bun: bunData,
  npm: npmData,
  pnpm: pnpmData,
  yarn: yarnData,
  docker: dockerData,
  kubectl: kubectlData,
  cargo: cargoData,
  brew: brewData,
};

export const BUILTIN_NAMES: ReadonlySet<string> = new Set(Object.keys(BUILTIN_MODULES));

export { defaultProfileData };
