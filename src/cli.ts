import { Command } from "commander";
import { ResolveConfig } from './index';
import packageJson from '../package.json';
import {createContext} from "./core/ctx";
import {getConfig} from "./core/utils";

const pkg = packageJson;

async function main() {
  const { config } = await getConfig<ResolveConfig>();
  const program = new Command();
  program.name(pkg.name).description(pkg.description).version(pkg.version);
  program.parse();

  const ctx = await createContext(config);

  await ctx.execute();

}

main();
