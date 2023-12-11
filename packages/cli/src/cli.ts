#!/usr/bin/env node

import CAC from 'cac'
import kleur from 'kleur'
import { main } from '.'
import { Dict, hyphenate } from 'cosmokit'

export function isInteger(source: any) {
  return typeof source === 'number' && Math.floor(source) === source
}

const { version } = require('../package.json')
const cli = CAC('cordis').help().version(version)

function toArg(key: string) {
  return key.length === 1 ? `-${key}` : `--${hyphenate(key)}`
}

function unparse(argv: Dict) {
  const execArgv = Object.entries(argv).flatMap<string>(([key, value]) => {
    if (key === '--') return []
    key = toArg(key)
    if (value === true) {
      return [key]
    } else if (value === false) {
      return ['--no-' + key.slice(2)]
    } else if (Array.isArray(value)) {
      return value.flatMap(value => [key, value])
    } else {
      return [key, value]
    }
  })
  execArgv.push(...argv['--'])
  if (!execArgv.includes('--experimental-vm-modules')) {
    execArgv.push('--experimental-vm-modules')
  }
  return execArgv
}

cli.command('start [file]', 'start a cordis application')
  .alias('run')
  .allowUnknownOptions()
  .option('--debug [namespace]', 'specify debug namespace')
  .option('--log-level [level]', 'specify log level (default: 2)')
  .option('--log-time [format]', 'show timestamp in logs')
  .action((file, options) => {
    const { logLevel, debug, logTime, ...rest } = options
    if (logLevel !== undefined && (!isInteger(logLevel) || logLevel < 0)) {
      console.warn(`${kleur.red('error')} log level should be a positive integer.`)
      process.exit(1)
    }
    process.env.CORDIS_LOG_LEVEL = logLevel || ''
    process.env.CORDIS_LOG_DEBUG = debug || ''
    process.env.CORDIS_LOADER_ENTRY = file || ''
    main({
      name: 'cordis',
      daemon: {
        execArgv: unparse(rest),
      },
      logger: {
        showTime: logTime,
      },
    })
  })

cli.parse()

if (!cli.matchedCommand) {
  cli.outputHelp()
}
