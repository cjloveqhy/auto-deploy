import { loadConfig } from "c12";
import { Command } from "commander";
import { Options } from './index';
import packageJson from '../package.json';
import {createContext} from "./core/ctx";

const pkg = packageJson;

async function main() {
  const { config } = await loadConfig<Options>({ name: 'ssh' });
  const program = new Command();
  program.name(pkg.name).description(pkg.description).version(pkg.version);
  program.parse();

  const ctx = await createContext(config);

  await ctx.execute();

}

main();
