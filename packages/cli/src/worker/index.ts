import Loader from '@cordisjs/loader'
import * as daemon from './daemon'
import * as logger from './logger'

export interface StartOptions {
  logger?: any
  daemon?: boolean
}

export async function start(name: string, options: StartOptions = {}) {
  const loader = new Loader(name)
  await loader.init(process.env.KOISHI_CONFIG_FILE)
  if (options.logger) loader.app.plugin(logger)
  if (options.daemon) loader.app.plugin(daemon)
  await loader.readConfig()
  await loader.createApp()
  await loader.app.start()
}

if (require.main === module) {
  start(process.env.CORDIS_APP!)
}
