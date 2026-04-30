declare module "bash-parser" {
  function parse(source: string, options?: Readonly<Record<string, unknown>>): unknown;
  export default parse;
}
