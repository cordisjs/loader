import { Logger } from '@cordisjs/logger'
import Loader from '@cordisjs/loader'
import * as daemon from './daemon'
import * as logger from './logger'

function handleException(error: any) {
  new Logger('app').error(error)
  process.exit(1)
}

process.on('uncaughtException', handleException)

process.on('unhandledRejection', (error) => {
  new Logger('app').warn(error)
})

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
  start(process.env.CORDIS_APP!).catch(handleException)
}
