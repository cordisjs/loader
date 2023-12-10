import { Logger } from '@cordisjs/logger'
import { Context } from 'cordis'

interface LogLevelConfig {
  // a little different from @koishijs/utils
  // we don't enforce user to provide a base here
  // @ts-ignore
  base?: number
  [K: string]: LogLevel
}

type LogLevel = number | LogLevelConfig

export interface Config {
  levels?: LogLevel
  showDiff?: boolean
  showTime?: string | boolean
}

export function apply(ctx: Context, config: Config = {}) {
  Logger.targets.push({
    colors: 3,
    record: (record) => {
      ctx.loader.prolog.push(record)
      ctx.loader.prolog = ctx.loader.prolog.slice(-1000)
    },
  })

  const { levels } = config
  // configurate logger levels
  if (typeof levels === 'object') {
    Logger.levels = levels as any
  } else if (typeof levels === 'number') {
    Logger.levels.base = levels
  }

  let showTime = config.showTime
  if (showTime === true) showTime = 'yyyy-MM-dd hh:mm:ss'
  if (showTime) Logger.targets[0].showTime = showTime
  Logger.targets[0].showDiff = config.showDiff

  // cli options have higher precedence
  if (process.env.KOISHI_LOG_LEVEL) {
    Logger.levels.base = +process.env.KOISHI_LOG_LEVEL
  }

  function ensureBaseLevel(config: Logger.LevelConfig, base: number) {
    config.base ??= base
    Object.values(config).forEach((value) => {
      if (typeof value !== 'object') return
      ensureBaseLevel(value, config.base)
    })
  }

  ensureBaseLevel(Logger.levels, 2)

  if (process.env.KOISHI_DEBUG) {
    for (const name of process.env.KOISHI_DEBUG.split(',')) {
      new Logger(name).level = Logger.DEBUG
    }
  }

  Logger.targets[0].timestamp = Date.now()
}
