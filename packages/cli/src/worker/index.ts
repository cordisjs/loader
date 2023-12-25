import Loader from '@cordisjs/loader'
import * as daemon from './daemon'
import * as logger from './logger'

export interface Options extends Loader.Options {
  logger?: logger.Config
  daemon?: daemon.Config
}

export async function main(options: Options) {
  const loader = new Loader(options)
  await loader.init(process.env.CORDIS_LOADER_ENTRY)
  if (options.logger) loader.app.plugin(logger)
  if (options.daemon) loader.app.plugin(daemon)
  await loader.readConfig()
  await loader.start()
}

if (process.env.CORDIS_LOADER_OPTIONS) {
  main(JSON.parse(process.env.CORDIS_LOADER_OPTIONS))
}
