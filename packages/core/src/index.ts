import { Logger } from '@cordisjs/logger'
import { Loader } from './shared'
import { promises as fs } from 'fs'
import * as dotenv from 'dotenv'

export * from './shared'

const logger = new Logger('app')

// eslint-disable-next-line n/no-deprecated-api
for (const key in require.extensions) {
  Loader.extensions.add(key)
}

const initialKeys = Object.getOwnPropertyNames(process.env)

namespace NodeLoader {
  export interface Options extends Loader.Options {}
}

function inferInputType() {
  if (typeof require !== 'undefined' && typeof module !== 'undefined') return 'commonjs'
  return 'module'
}

class NodeLoader extends Loader<NodeLoader.Options> {
  public inputType = inferInputType()
  public localKeys: string[] = []

  async readConfig() {
    // remove local env variables
    for (const key of this.localKeys) {
      delete process.env[key]
    }

    // load env files
    const parsed = {}
    for (const filename of this.envFiles) {
      try {
        const raw = await fs.readFile(filename, 'utf8')
        Object.assign(parsed, dotenv.parse(raw))
      } catch {}
    }

    // write local env into process.env
    this.localKeys = []
    for (const key in parsed) {
      if (initialKeys.includes(key)) continue
      process.env[key] = parsed[key]
      this.localKeys.push(key)
    }

    return await super.readConfig()
  }

  async import(name: string) {
    try {
      if (this.inputType === 'commonjs') {
        return require(name)
      } else {
        return await import(name)
      }
    } catch (err: any) {
      logger.error(err.message)
    }
  }

  fullReload(code = Loader.exitCode) {
    const body = JSON.stringify(this.envData)
    process.send?.({ type: 'shared', body }, (err: any) => {
      if (err) logger.error('failed to send shared data')
      logger.info('trigger full reload')
      process.exit(code)
    })
  }
}

export default NodeLoader
